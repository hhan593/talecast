import { describe, expect, it } from 'vitest';

import { pageForOffset, paginateText } from './reader';

const M = { charsPerLine: 10, linesPerPage: 4 };

/** 合同断言：页区间衔接、覆盖全文（含换行）、切片拼接即原文 */
function expectCoversText(text: string, baseOffset: number, pages: ReturnType<typeof paginateText>) {
  expect(pages[0].startOffset).toBe(baseOffset);
  expect(pages[pages.length - 1].endOffset).toBe(baseOffset + text.length);
  let rebuilt = '';
  for (const page of pages) rebuilt += text.slice(page.startOffset, page.endOffset);
  expect(rebuilt).toBe(text);
}

describe('paginateText', () => {
  it('确定性：同输入同分页', () => {
    const text = '第一段内容。\n第二段内容更长一些，用来验证分页边界。\n第三段。';
    expect(paginateText(text, 0, M)).toEqual(paginateText(text, 0, M));
  });

  it('视觉行数 ≤ 每页容量时为单页并覆盖全文', () => {
    const text = '清晨的雾还没有散去。\n青石板路上已经响起了脚步声。\n第三行正文。\n第四行正文。';
    const pages = paginateText(text, 0, { charsPerLine: 20, linesPerPage: 4 });
    expect(pages.length).toBe(1);
    expectCoversText(text, 0, pages);
  });

  it('行宽超过每行容量时折算多视觉行（2 页）', () => {
    const text = '清晨的雾还没有散去。\n青石板路上已经响起了脚步声。\n第三行正文。\n第四行正文。';
    const pages = paginateText(text, 0, { charsPerLine: 10, linesPerPage: 4 });
    expect(pages.length).toBe(2);
    expectCoversText(text, 0, pages);
  });

  it('多行文本按视觉段打包成多页，切片拼接即原文', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `第${i + 1}行正文内容完整。`).join('\n');
    const pages = paginateText(lines, 0, M);
    expect(pages.length).toBe(3);
    expect(pages.map((p) => p.ordinal)).toEqual([0, 1, 2]);
    let rebuilt = '';
    for (const page of pages) rebuilt += lines.slice(page.startOffset, page.endOffset);
    expect(rebuilt).toBe(lines);
  });

  it('超长段落跨页硬切，页边界落在段边界上', () => {
    const text = '啊'.repeat(25) + '\n' + '哦'.repeat(15);
    const pages = paginateText(text, 0, M);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < pages.length; i++) {
      expect(pages[i].startOffset).toBe(pages[i - 1].endOffset);
    }
    // 每页内容都是原文的连续切片（不丢字、不重字）
    let rebuilt = '';
    for (const page of pages) rebuilt += text.slice(page.startOffset, page.endOffset);
    expect(rebuilt).toBe(text);
  });

  it('空行计入页容量（零宽段），换行符归入前页范围', () => {
    const text = 'A。\n\n\nB。';
    const pages = paginateText(text, 0, { charsPerLine: 10, linesPerPage: 3 });
    expect(pages.length).toBe(2);
    expect(pages[1].startOffset).toBe(text.indexOf('B'));
    expectCoversText(text, 0, pages);
  });

  it('非法 metrics 抛错', () => {
    expect(() => paginateText('x', 0, { charsPerLine: 0, linesPerPage: 1 })).toThrow(RangeError);
    expect(() => paginateText('x', 0, { charsPerLine: 1, linesPerPage: -1 })).toThrow(RangeError);
  });
});

describe('pageForOffset', () => {
  it('偏移落在页区间时返回对应页', () => {
    const text = '啊'.repeat(40);
    const pages = paginateText(text, 0, { charsPerLine: 10, linesPerPage: 3 });
    // 4 段 → 2 页：0-30 / 30-40
    expect(pageForOffset(pages, 0)).toBe(0);
    expect(pageForOffset(pages, 35)).toBe(1);
    expect(pageForOffset(pages, 39)).toBe(1);
  });

  it('越界偏移回落首页', () => {
    const pages = paginateText('内容。', 0, M);
    expect(pageForOffset(pages, -5)).toBe(0);
    expect(pageForOffset(pages, 100)).toBe(0);
  });
});
