import { describe, expect, it } from 'vitest';

import { detectChapterHeadings } from './split';

describe('detectChapterHeadings', () => {
  it('命中独立成行的章节标题', () => {
    const lines = ['序言', '第一章 重逢', '正文第一段……', '第 12 章 山雨欲来', '第两百三十一章'];
    const result = detectChapterHeadings(lines);
    expect(result).toEqual([
      { lineIndex: 1, title: '第一章 重逢' },
      { lineIndex: 3, title: '第 12 章 山雨欲来' },
      { lineIndex: 4, title: '第两百三十一章' },
    ]);
  });

  it('不命中正文里的伪标题', () => {
    const lines = [
      '他想起第一章节考试的事',
      '第一章还没写到',
      '这是第二章的内容',
      '第三章就要考试了',
      '',
    ];
    expect(detectChapterHeadings(lines)).toEqual([]);
  });

  it('标题超长不命中', () => {
    const long = '第一章 ' + '很'.repeat(60);
    expect(detectChapterHeadings([long])).toEqual([]);
  });

  it('空输入返回空数组', () => {
    expect(detectChapterHeadings([])).toEqual([]);
  });
});
