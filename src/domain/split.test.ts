import { describe, expect, it } from 'vitest';

import {
  assertAdoptable,
  assertUndoable,
  buildChapterDrafts,
  buildInitialChapterDrafts,
  detectChapterHeadingsInText,
} from './split';

describe('detectChapterHeadingsInText', () => {
  it('命中标题并给出行号与字符偏移', () => {
    const text = '序言\n第一章 重逢\n正文第一段\n\n第 12 章 山雨欲来\n正文第二段';
    const result = detectChapterHeadingsInText(text);
    expect(result).toEqual([
      { lineIndex: 1, startOffset: text.indexOf('第一章'), title: '第一章 重逢' },
      { lineIndex: 4, startOffset: text.indexOf('第 12 章'), title: '第 12 章 山雨欲来' },
    ]);
  });

  it('不命中正文里的伪标题', () => {
    const text = '他想起第一章节考试的事\n第一章还没写到\n这是第二章的内容\n';
    expect(detectChapterHeadingsInText(text)).toEqual([]);
  });
});

describe('buildChapterDrafts / buildInitialChapterDrafts', () => {
  it('章节半开区间衔接、覆盖全文，含前言与末章收尾', () => {
    const text = '前言文字\n第一章 重逢\n甲的正文\n第二章 别离\n乙的正文收尾';
    const drafts = buildInitialChapterDrafts(text);
    expect(drafts.map((d) => d.title)).toEqual(['前言', '第一章 重逢', '第二章 别离']);
    expect(drafts[0]).toMatchObject({ startOffset: 0, endOffset: text.indexOf('第一章') });
    expect(drafts[1]).toMatchObject({ startOffset: text.indexOf('第一章'), endOffset: text.indexOf('第二章') });
    expect(drafts[2]).toMatchObject({ startOffset: text.indexOf('第二章'), endOffset: text.length });
    // 衔接与覆盖
    for (let i = 1; i < drafts.length; i++) {
      expect(drafts[i].startOffset).toBe(drafts[i - 1].endOffset);
    }
    // 按偏移取回的章文正确
    expect(text.slice(drafts[1].startOffset, drafts[1].endOffset)).toBe('第一章 重逢\n甲的正文\n');
  });

  it('无标题命中时整本为单章', () => {
    const text = '没有章节标题的一本书';
    const drafts = buildInitialChapterDrafts(text);
    expect(drafts).toEqual([
      { title: '全文', startOffset: 0, endOffset: text.length, headingLine: null },
    ]);
  });

  it('首个标题前为纯空白时不产生前言章', () => {
    const text = '\n\n第一章 起点\n内容';
    const drafts = buildInitialChapterDrafts(text);
    expect(drafts.map((d) => d.title)).toEqual(['第一章 起点']);
    expect(drafts[0].startOffset).toBe(text.indexOf('第一章'));
  });
});

describe('采用/撤销守卫', () => {
  const base = { currentRevision: 3, expectedRevision: 3 };
  it('pending 且修订匹配才可采用', () => {
    expect(assertAdoptable('pending', base.currentRevision, base.expectedRevision)).toBeNull();
    expect(assertAdoptable('adopted', base.currentRevision, base.expectedRevision)).toMatch(/已被采用或撤销/);
    expect(assertAdoptable('pending', 4, 3)).toMatch(/已被其他操作修改/);
  });
  it('只有 adopted 才可撤销', () => {
    expect(assertUndoable('adopted', base.currentRevision, base.expectedRevision)).toBeNull();
    expect(assertUndoable('pending', base.currentRevision, base.expectedRevision)).toMatch(/只有已采用/);
    expect(assertUndoable('withdrawn', base.currentRevision, base.expectedRevision)).toMatch(/只有已采用/);
  });
});
