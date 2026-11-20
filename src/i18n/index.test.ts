import { describe, expect, it } from 'vitest';

import { missingTranslations, resolveLocale, setLocale, t } from './index';

describe('i18n', () => {
  it('t()：en 键翻译', () => {
    setLocale('en');
    expect(t('shelf.add')).toBe('＋ Add Book');
    expect(t('settings.title')).toBe('Settings');
    setLocale('zh');
    expect(t('shelf.add')).toBe('＋ 添加书籍');
  });

  it('resolveLocale：显式设置生效（system 依赖运行环境语言，不在此断言）', () => {
    expect(resolveLocale('zh')).toBe('zh');
    expect(resolveLocale('en')).toBe('en');
  });

  it('英文无漏键：缺失键会静默回退中文，等于局部没翻译', () => {
    expect(missingTranslations('en')).toEqual([]);
  });

  it('插值：{name} 替换，缺参保留占位符', () => {
    setLocale('zh');
    expect(t('reader.segmentOf', { index: 1, total: 3 })).toBe('第 1/3 段');
    expect(t('reader.selectedChars', {})).toContain('{count}');
    setLocale('en');
    expect(t('characters.unboundHint', { voice: 'Xiaoxiao' })).toContain('default voice');
    setLocale('zh');
  });
});
