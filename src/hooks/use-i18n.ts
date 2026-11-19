import { useCallback, useEffect, useState } from 'react';

import { useServices } from '@/container';
import { getLocale, setLocale, subscribeLocale, t, type Locale, type StringKey } from '@/i18n';

/** 界面语言入口（v0.14.0）：读取设置 → 模块级 locale 订阅重渲 */
export function useI18n() {
  const services = useServices();
  const [locale, setLocaleState] = useState<Locale>(getLocale());

  useEffect(() => {
    const unsubscribe = subscribeLocale(setLocaleState);
    void services.settings.getSetting('app-language').then((saved) => {
      if (saved === 'zh' || saved === 'en') {
        setLocale(saved);
      } else {
        // system：非中文环境回退英文
        const systemEn =
          typeof navigator !== 'undefined' && !navigator.language.toLowerCase().startsWith('zh');
        setLocale(systemEn ? 'en' : 'zh');
      }
    });
    return unsubscribe;
  }, [services]);

  const changeLanguage = useCallback(
    async (language: 'system' | 'zh' | 'en') => {
      await services.settings.setSetting('app-language', language);
      const next =
        language === 'zh' || language === 'en'
          ? language
          : typeof navigator !== 'undefined' && !navigator.language.toLowerCase().startsWith('zh')
            ? 'en'
            : 'zh';
      setLocale(next);
    },
    [services],
  );

  return { locale, t, changeLanguage };
}

export type { StringKey };
