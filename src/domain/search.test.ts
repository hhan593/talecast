import { describe, expect, it } from 'vitest';

import { findHitOffsets, searchBook } from './search';

describe('findHitOffsets', () => {
  it('全部命中位置，支持重叠推进', () => {
    expect(findHitOffsets('啊啊啊', '啊')).toEqual([0, 1, 2]);
    expect(findHitOffsets('Hello hello HELLO', 'hello')).toEqual([0, 6, 12]);
    expect(findHitOffsets('没有命中', '存在')).toEqual([]);
    expect(findHitOffsets('任意', '')).toEqual([]);
  });
});

describe('searchBook', () => {
  const chapters = [
    { chapterId: 'c1', chapterTitle: '第一章', startOffset: 0, endOffset: 20 },
    { chapterId: 'c2', chapterTitle: '第二章', startOffset: 20, endOffset: 40 },
  ];
  const text = 'A'.repeat(20) + 'B'.repeat(20);

  it('命中归属正确章节，摘录含命中词', () => {
    const results = searchBook(text, 'B', chapters);
    expect(results.length).toBe(20);
    expect(results[0].chapterId).toBe('c2');
    expect(results[0].excerpt).toContain('B');
  });

  it('边界命中归入前一章（半开区间）', () => {
    const results = searchBook(text, 'A', chapters);
    expect(results.every((r) => r.chapterId === 'c1')).toBe(true);
  });
});
