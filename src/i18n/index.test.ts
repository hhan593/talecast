import { describe, expect, it } from 'vitest';

import { resolveLocale, setLocale, t } from './index';

describe('v0.14.0 i18n', () => {
  it('t()：en 键翻译 + 缺失回退中文', () => {
    setLocale('en');
    expect(t('shelf.add')).toBe('＋ Add Book');
    expect(t('settings.title')).toBe('Settings');
    // en 未覆盖的键回退中文
    expect(t('reader.minutesLeft')).toBe('分钟');
    setLocale('zh');
    expect(t('shelf.add')).toBe('＋ 添加书籍');
  });

  it('resolveLocale：显式设置生效（system 依赖运行环境语言，不在此断言）', () => {
    expect(resolveLocale('zh')).toBe('zh');
    expect(resolveLocale('en')).toBe('en');
  });
});
