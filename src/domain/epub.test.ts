import { describe, expect, it } from 'vitest';

import { parseEpub, stripHtml } from './epub';
import { buildSampleEpub } from '../../tests/fixtures/sample-epub';
import { createJszipEpubDeps } from '@/adapters/epub';

describe('stripHtml', () => {
  it('块级标签转换行、实体还原', () => {
    expect(stripHtml('<p>A</p><p>B</p>')).toBe('A\nB\n');
    expect(stripHtml('A &amp; B')).toBe('A & B');
  });
});

describe('parseEpub', () => {
  it('解析书名与 spine 章节（fixture EPUB）', async () => {
    const bytes = await buildSampleEpub();
    const result = await parseEpub(createJszipEpubDeps(bytes), bytes);
    expect(result.bookTitle).toBe('山河故人');
    expect(result.chapters.map((c) => c.title)).toEqual(['第一章 重逢', '第二章 别离']);
    expect(result.chapters[0].text).toContain('清晨的雾还没有散去');
    expect(result.chapters[1].text).toContain('那天的雨下了整夜');
  });

  it('损坏容器给出明确错误', async () => {
    const bytes = new TextEncoder().encode('not a zip');
    await expect(parseEpub(createJszipEpubDeps(bytes), bytes)).rejects.toThrow(/EPUB|zip|缺少/i);
  });
});
