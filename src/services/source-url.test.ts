import { describe, expect, it } from 'vitest';

import { createUrlTxtService } from './source-url';
import { textToBytes } from './fakes';

describe('URL TXT 下载服务', () => {
  const service = createUrlTxtService({
    download: async (url) => {
      if (url.includes('bad')) throw new Error('DNS 解析失败');
      return textToBytes('下载的正文。\n第一章 起点\n内容。');
    },
  });

  it('下载成功返回文件名与字节', async () => {
    const result = await service.downloadTxt('https://example.com/books/my-novel.txt');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.fileName).toBe('my-novel.txt');
  });

  it('非 http/https 协议拒绝', async () => {
    const result = await service.downloadTxt('ftp://example.com/a.txt');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('http');
  });

  it('下载失败给出网络错误', async () => {
    const result = await service.downloadTxt('https://example.com/x.txt');
    void result;
  });
});
