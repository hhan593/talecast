import { fetch } from 'expo/fetch';

import { err, ok, type Result } from '@/domain/result';

/**
 * 在线书源阶段一（docs/design/2026-11-19-phase2-plan.md §6）：
 * URL TXT 下载导入——纯下载不含书源规则；非文本/超限给出明确错误。
 */
export interface UrlTxtDeps {
  /** 下载 → 字节；调用方处理超时与 UA */
  download: (url: string) => Promise<Uint8Array>;
}

const MAX_URL_TXT_BYTES = 16 * 1024 * 1024;

export function createUrlTxtService(deps: UrlTxtDeps) {
  return {
    /** 下载 URL 指向的 TXT 文本（字节），校验通过后由调用方走 runImport 管线 */
    async downloadTxt(url: string): Promise<Result<{ fileName: string; bytes: Uint8Array }>> {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return err('invalid', 'URL 格式不正确');
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return err('invalid', '仅支持 http/https 链接');
      }
      try {
        const response = await deps.download(url);
        if (response.length === 0) return err('invalid', '下载内容为空');
        if (response.length > MAX_URL_TXT_BYTES) {
          return err('invalid', `文件超出 16MB 上限（${(response.length / 1024 / 1024).toFixed(1)}MB）`);
        }
        const fileName = decodeURIComponent(parsed.pathname.split('/').pop() || 'remote.txt');
        return ok({ fileName, bytes: response });
      } catch (error) {
        return err('network', `下载失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}

export type UrlTxtService = ReturnType<typeof createUrlTxtService>;
