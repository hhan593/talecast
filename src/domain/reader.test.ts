import { describe, expect, it } from 'vitest';

import { nextTheme, isReaderThemeKey, READER_THEMES, THEME_CYCLE } from './reader-theme';
import { pageForOffset, paginateText, paragraphIndexAtScrollY, paragraphIndexForOffset } from './reader';

describe('reader theme', () => {
  it('主题循环：四套主题顺序循环', () => {
    expect(nextTheme('paper')).toBe('green');
    expect(nextTheme('green')).toBe('white');
    expect(nextTheme('white')).toBe('night');
    expect(nextTheme('night')).toBe('paper');
  });

  it('四套主题 token 完整（bg/surface/text/muted/border/action/actionText/highlightBg/accent）', () => {
    for (const [key, tokens] of Object.entries(READER_THEMES)) {
      for (const prop of ['bg', 'bgHex', 'surface', 'text', 'muted', 'mutedHex', 'border', 'action', 'actionText', 'highlightBg', 'accent']) {
        expect(tokens[prop as keyof typeof tokens]).toBeDefined();
      }
      void key;
    }
  });

  it('isReaderThemeKey 校验', () => {
    expect(isReaderThemeKey('paper')).toBe(true);
    expect(isReaderThemeKey('dark')).toBe(false);
  });

  it('THEME_CYCLE 与 nextTheme 一致', () => {
    for (const key of THEME_CYCLE) {
      const index = THEME_CYCLE.indexOf(key);
      expect(nextTheme(key)).toBe(THEME_CYCLE[(index + 1) % THEME_CYCLE.length]);
    }
  });
});

describe('v0.8.0 排版分页（段间距 / 首行缩进）', () => {
  /** 6 段，每段 23 字（3 视觉行 @10 字/行），单换行分隔 */
  const text = Array.from({ length: 6 }, (_, i) => `第${i}段${'字'.repeat(20)}`).join('\n');

  function assertConcatenation(pages: ReturnType<typeof paginateText>, source: string, base: number) {
    const joined = pages
      .map((p) => source.slice(p.startOffset - base, p.endOffset - base))
      .join('');
    expect(joined).toBe(source);
  }

  it('段间距像素预算：同页段边界预留间距，页切片拼接仍为全文', () => {
    const metrics = { charsPerLine: 10, linesPerPage: 4, lineHeightPx: 20, paragraphSpacingPx: 10 };
    const pages = paginateText(text, 100, metrics);
    assertConcatenation(pages, text, 100);
    // 页容量 80px：3 行段（60px）+ 间距 10 + 下一行 20 = 90 超限 → 每页只装 1 段
    expect(pages.length).toBe(6);
    // 无间距时同容量更省行：每页 4 视觉行（1 段 + 下段首行）
    const plain = paginateText(text, 100, { charsPerLine: 10, linesPerPage: 4 });
    expect(plain.length).toBe(5);
  });

  it('跨页边界不重复计间距：页尾恰为段尾时间距落在两页之外', () => {
    const metrics = { charsPerLine: 10, linesPerPage: 3, lineHeightPx: 20, paragraphSpacingPx: 30 };
    const pages = paginateText(text, 0, metrics);
    // 每段 3 视觉行 = 每页恰好一段（60px = 容量）；间距 30 若计入将切为 2 行/页
    expect(pages.length).toBe(6);
    assertConcatenation(pages, text, 0);
  });

  it('首行缩进：段首行少排 N 字，页数随之增加且不丢字', () => {
    const line = '一二三四五六七八九十'; // 10 字
    const source = `${line}\n${line}`;
    const base = 0;
    const without = paginateText(source, base, { charsPerLine: 10, linesPerPage: 2 });
    const withIndent = paginateText(source, base, {
      charsPerLine: 10,
      linesPerPage: 2,
      indentChars: 2,
    });
    // 无缩进：每行 1 视觉段 → 两行同页；缩进后每行 2 段 → 每页一段
    expect(without.length).toBe(1);
    expect(withIndent.length).toBe(2);
    assertConcatenation(withIndent, source, base);
    assertConcatenation(without, source, base);
  });

  it('像素预算下空行仍计一行高度（行为与旧分页一致）', () => {
    const source = '甲乙丙丁\n\n戊己庚辛';
    const metrics = { charsPerLine: 4, linesPerPage: 2, lineHeightPx: 20, paragraphSpacingPx: 10 };
    const pages = paginateText(source, 0, metrics);
    assertConcatenation(pages, source, 0);
    // 3 行（含空行）：页容量 40px；行1(20) 空行(20+间距10 超) → 每页 1 行
    expect(pages.length).toBe(3);
  });
});

describe('v0.19.x 滚动模式位置互查（issue #64 收尾）', () => {
  it('paragraphIndexAtScrollY：顶边所在段 = 最后一个 top ≤ scrollY 的段', () => {
    const tops = [0, 120, 300, 300, 480];
    expect(paragraphIndexAtScrollY([], 0)).toBe(0); // 空章节回落首段
    expect(paragraphIndexAtScrollY(tops, 0)).toBe(0);
    expect(paragraphIndexAtScrollY(tops, 119.9)).toBe(0);
    expect(paragraphIndexAtScrollY(tops, 120)).toBe(1);
    expect(paragraphIndexAtScrollY(tops, 250)).toBe(1); // 段中间仍在该段
    expect(paragraphIndexAtScrollY(tops, 300)).toBe(3); // 零高段与上段同顶：取后者
    expect(paragraphIndexAtScrollY(tops, 479)).toBe(3);
    expect(paragraphIndexAtScrollY(tops, 480)).toBe(4);
    expect(paragraphIndexAtScrollY(tops, 9999)).toBe(4); // 越界回落末段
  });

  it('paragraphIndexForOffset：恢复定位 = 最后一个 startOffset ≤ offset 的段', () => {
    const starts = [100, 160, 220];
    expect(paragraphIndexForOffset([0], 9999)).toBe(0);
    expect(paragraphIndexForOffset(starts, 0)).toBe(0); // 越界回落首段
    expect(paragraphIndexForOffset(starts, 100)).toBe(0);
    expect(paragraphIndexForOffset(starts, 159)).toBe(0);
    expect(paragraphIndexForOffset(starts, 161)).toBe(1);
    expect(paragraphIndexForOffset(starts, 250)).toBe(2); // 段中间仍在末段
  });
});
