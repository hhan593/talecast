import { describe, expect, it } from 'vitest';

import { isReaderThemeKey, nextTheme, READER_THEMES, THEME_CYCLE } from './reader-theme';

describe('reader theme', () => {
  it('主题循环：四套主题顺序循环', () => {
    expect(nextTheme('paper')).toBe('green');
    expect(nextTheme('green')).toBe('white');
    expect(nextTheme('night')).toBe('paper');
  });

  it('四套主题 token 完整', () => {
    for (const tokens of Object.values(READER_THEMES)) {
      for (const prop of ['bg', 'surface', 'text', 'muted', 'border', 'action', 'actionText', 'highlightBg', 'accent']) {
        expect(tokens[prop as keyof typeof tokens]).toBeDefined();
      }
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
