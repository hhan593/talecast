import { fetch } from 'expo/fetch';

import type { UpdateGateway } from '@/domain/ports';
import type { ReleaseInfo } from '@/domain/update';

/**
 * GitHub Releases latest 查询（issue #58 P1）。
 * 匿名限额 60 次/小时/IP：调用方（services/update）负责节流，这里只做单次请求。
 * 任何失败（网络 / 非 2xx / 字段缺失）→ null，由调用方静默降级，不抛错。
 */
export function createGithubReleaseGateway(repo: string): UpdateGateway {
  return {
    async fetchLatestRelease(): Promise<ReleaseInfo | null> {
      try {
        const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (!response.ok) return null;
        const data = (await response.json()) as {
          tag_name?: string;
          html_url?: string;
          body?: string | null;
          assets?: Array<{ name?: string; browser_download_url?: string }>;
        };
        if (!data.tag_name || !data.html_url) return null;
        const assets = (data.assets ?? [])
          .filter((a) => typeof a.name === 'string' && typeof a.browser_download_url === 'string')
          .map((a) => ({ name: a.name as string, url: a.browser_download_url as string }));
        return { tagName: data.tag_name, htmlUrl: data.html_url, notes: data.body ?? '', assets };
      } catch {
        return null;
      }
    },

    async fetchText(url) {
      try {
        const response = await fetch(url, { headers: { Accept: 'text/plain' } });
        if (!response.ok) return null;
        return await response.text();
      } catch {
        return null;
      }
    },
  };
}
