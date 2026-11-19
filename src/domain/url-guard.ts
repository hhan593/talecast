/**
 * URL 导入 SSRF 防护（docs/design/2026-11-20-v0.10-v0.16-roadmap.md v0.10.0）：
 * 仅公网 http/https；字面主机名逐类拒绝私网/环回/链路本地等。
 * domain 纯函数（可测）；DNS 解析后复检经可选 resolver 注入——
 * RN 无直接 DNS API，未注入时仅做字面校验（DNS rebinding 残余风险记录于计划书）。
 */

export type UrlGuardError =
  | 'protocol'
  | 'credentials'
  | 'hostname'
  | 'private'
  | 'loopback'
  | 'linklocal';

/** 判断 IPv4 是否私网/保留段（RFC1918/5735/6598 等） */
export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return false; // 不是合法 IPv4：交由其他规则处理
  }
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 169 && b === 254) return true; // 链路本地
  if (a === 127) return true; // 环回
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0/24
  if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET-1
  if (a === 198 && b === 18) return true; // 基准测试
  if (a === 198 && b === 51 && parts[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // 组播/保留
  return false;
}

/** 判断 IPv6 字面量是否环回/链路本地/ULA/内网映射 */
export function isPrivateIpv6(raw: string): boolean {
  const ip = raw.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (ip === '::1' || ip === '::') return true; // 环回 / 未指定
  if (ip.startsWith('fe80')) return true; // 链路本地
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // ULA fc00::/7
  if (ip.startsWith('::ffff:')) {
    // IPv4 映射地址 ::ffff:10.0.0.1
    const v4 = ip.slice(7);
    if (v4.includes('.')) return isPrivateIpv4(v4);
  }
  return false;
}

const LOOPBACK_HOSTS = new Set(['localhost', 'ip6-localhost', 'ip6-loopback', 'localhost.localdomain']);
const LOCAL_SUFFIXES = ['.local', '.localdomain', '.internal', '.lan', '.home', '.arpa'];

export type UrlGuardResult = { ok: true; host: string } | { ok: false; error: UrlGuardError; message: string };

function reject(error: UrlGuardError, message: string): UrlGuardResult {
  return { ok: false, error, message };
}

/** 校验 URL 指向公网 http/https 资源（字面主机名层） */
export function assertPublicHttpUrl(url: string): UrlGuardResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return reject('hostname', 'URL 格式不正确');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return reject('protocol', '仅支持 http/https 链接');
  }
  if (parsed.username || parsed.password) {
    return reject('credentials', '不支持带用户名密码的链接');
  }
  const host = parsed.hostname.trim().toLowerCase();
  if (host.length === 0) return reject('hostname', '缺少主机名');
  if (LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost')) {
    return reject('loopback', '不允许访问本机地址');
  }
  if (LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return reject('private', '不允许访问内网域名');
  }
  if (host === 'metadata.google.internal' || host.endsWith('.internal')) {
    return reject('private', '不允许访问内网域名');
  }
  // IPv4 字面量（host 可能带方括号的是 IPv6）
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    if (isPrivateIpv4(host)) {
      return reject('private', '不允许访问私网/保留地址');
    }
  }
  if (host.includes(':') || (host.startsWith('[') && host.endsWith(']'))) {
    if (isPrivateIpv6(host)) {
      return reject('private', '不允许访问私网/保留地址');
    }
  }
  return { ok: true, host };
}

export interface UrlGuardDeps {
  /** 可选：DNS 解析后复检（防字面域名指向私网 IP）；RN 环境可不注入 */
  resolveHost?: (host: string) => Promise<string[]>;
}

/** 带可选 DNS 复检的完整校验；resolver 注入时解析出的每个 IP 都必须公网 */
export async function assertPublicHttpUrlDeep(
  url: string,
  deps: UrlGuardDeps = {},
): Promise<UrlGuardResult> {
  const literal = assertPublicHttpUrl(url);
  if (!literal.ok) return literal;
  if (!deps.resolveHost) return literal;
  try {
    const addresses = await deps.resolveHost(literal.host);
    for (const address of addresses) {
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address) && isPrivateIpv4(address)) {
        return reject('private', '域名解析到私网地址，已拦截');
      }
      if (address.includes(':') && isPrivateIpv6(address)) {
        return reject('private', '域名解析到私网地址，已拦截');
      }
    }
  } catch {
    // 解析失败交由后续 fetch 报网络错误（不因校验增强而拦截下载）
  }
  return literal;
}
