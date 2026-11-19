import { describe, expect, it } from 'vitest';

import { nextTheme, isReaderThemeKey, READER_THEMES, THEME_CYCLE } from './reader-theme';
import { pageForOffset, paginateText } from './reader';

describe('reader theme', () => {
  it('主题循环：四套主题顺序循环', () => {
    expect(nextTheme('paper')).toBe('green');
    expect(nextTheme('green')).toBe('white');
    expect(nextTheme('white')).toBe('night');
    expect(nextTheme('night')).toBe('paper');
  });

  it('四套主题 token 完整（bg/surface/text/muted/border/action/actionText/highlightBg/accent）', () => {
    for (const [key, tokens] of Object.entries(READER_THEMES)) {
      for (const prop of ['bg', 'surface', 'text', 'muted', 'border', 'action', 'actionText', 'highlightBg', 'accent']) {
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
