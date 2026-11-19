import { describe, expect, it } from 'vitest';

import { assertPublicHttpUrl, assertPublicHttpUrlDeep, isPrivateIpv4, isPrivateIpv6 } from './url-guard';

describe('isPrivateIpv4', () => {
  it('RFC1918/环回/链路本地/保留段', () => {
    for (const ip of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '127.0.0.1', '0.0.0.0', '169.254.1.1', '100.64.0.1', '224.0.0.1', '255.255.255.255', '192.0.2.55']) {
      expect(isPrivateIpv4(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1']) {
      expect(isPrivateIpv4(ip), ip).toBe(false);
    }
  });
});

describe('isPrivateIpv6', () => {
  it('环回/未指定/链路本地/ULA/IPv4 映射', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:10.0.0.1', '[::1]']) {
      expect(isPrivateIpv6(ip), ip).toBe(true);
    }
    for (const ip of ['2001:db8::1', '2606:4700::1111']) {
      expect(isPrivateIpv6(ip), ip).toBe(false);
    }
  });
});

describe('assertPublicHttpUrl', () => {
  it('公网 URL 放行并返回主机', () => {
    const result = assertPublicHttpUrl('https://example.com/book.txt');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.host).toBe('example.com');
  });

  it('协议/凭据/格式拒绝', () => {
    expect(assertPublicHttpUrl('ftp://example.com/a.txt').ok).toBe(false);
    expect(assertPublicHttpUrl('file:///etc/passwd').ok).toBe(false);
    expect(assertPublicHttpUrl('https://user:pass@example.com/a').ok).toBe(false);
    expect(assertPublicHttpUrl('not a url').ok).toBe(false);
  });

  it('环回/内网/元数据地址拒绝', () => {
    const blocked = [
      'http://localhost/book.txt',
      'http://LOCALHOST:8080/a.txt',
      'http://127.0.0.1:3000/a.txt',
      'http://10.0.0.5/a.txt',
      'http://192.168.1.10/a.txt',
      'http://172.20.1.1/a.txt',
      'http://169.254.169.254/latest/meta-data/',
      'http://0.0.0.0/a.txt',
      'http://[::1]/a.txt',
      'http://[fe80::1]/a.txt',
      'http://nas.local/a.txt',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://db.internal/a.txt',
      // 数字/十六进制/缩写绕过（issue #36）
      'http://2130706433/a.txt',
      'http://0x7f000001/a.txt',
      'http://127.1/a.txt',
      'http://10.1/a.txt',
    ];
    for (const url of blocked) {
      const result = assertPublicHttpUrl(url);
      expect(result.ok, url).toBe(false);
    }
  });
});

describe('assertPublicHttpUrlDeep（DNS 复检）', () => {
  it('域名解析到私网 IP 时拦截', async () => {
    const result = await assertPublicHttpUrlDeep('https://evil.example.com/a.txt', {
      resolveHost: async () => ['10.0.0.8'],
    });
    expect(result.ok).toBe(false);
  });

  it('公网解析放行；解析器抛错不拦截（交由下载报网络错误）', async () => {
    const okResult = await assertPublicHttpUrlDeep('https://example.com/a.txt', {
      resolveHost: async () => ['93.184.216.34'],
    });
    expect(okResult.ok).toBe(true);
    const errResult = await assertPublicHttpUrlDeep('https://example.com/a.txt', {
      resolveHost: async () => {
        throw new Error('dns down');
      },
    });
    expect(errResult.ok).toBe(true);
  });
});
