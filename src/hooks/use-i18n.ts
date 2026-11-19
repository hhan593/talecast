import { useCallback, useEffect, useState } from 'react';

import { useServices } from '@/container';
import { getLocale, resolveLocale, setLocale, subscribeLocale, t, type Locale, type StringKey } from '@/i18n';

/** 界面语言入口（v0.14.0）：读取设置 → 模块级 locale 订阅重渲 */
export function useI18n() {
  const services = useServices();
  const [locale, setLocaleState] = useState<Locale>(getLocale());

  useEffect(() => {
    const unsubscribe = subscribeLocale(setLocaleState);
    void services.settings.getSetting('app-language').then((saved) => {
      // system 分支统一走 resolveLocale（与 i18n 测试同源，issue #41）
      setLocale(resolveLocale(saved === 'zh' || saved === 'en' ? saved : 'system'));
    });
    return unsubscribe;
  }, [services]);

  const changeLanguage = useCallback(
    async (language: 'system' | 'zh' | 'en') => {
      await services.settings.setSetting('app-language', language);
      setLocale(resolveLocale(language));
    },
    [services],
  );

  return { locale, t, changeLanguage };
}

export type { StringKey };
