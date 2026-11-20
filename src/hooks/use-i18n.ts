import { useCallback, useEffect, useState } from 'react';

import { useServices } from '@/container';
import {
  getLocale,
  resolveLocale,
  setLocale,
  subscribeLocale,
  translate,
  type Locale,
  type StringKey,
} from '@/i18n';

/**
 * 界面语言入口（v0.14.0）：读取设置 → 订阅变更重渲。
 *
 * 返回的 t 绑定当前 React state（而非模块单例）：模块级 locale 只在 setLocale 变更时
 * 通知订阅者，组件若在通知之外渲染会拿到旧值，表现为"设置页已是英文、个别界面仍是中文"。
 */
export function useI18n() {
  const services = useServices();
  const [locale, setLocaleState] = useState<Locale>(getLocale());

  useEffect(() => {
    const unsubscribe = subscribeLocale(setLocaleState);
    void services.settings.getSetting('app-language').then((saved) => {
      // system 分支统一走 resolveLocale（与 i18n 测试同源，issue #41）
      const resolved = resolveLocale(saved === 'zh' || saved === 'en' ? saved : 'system');
      setLocale(resolved);
      // setLocale 在值相同时早退不发通知，这里直接同步本地 state
      setLocaleState(resolved);
    });
    return unsubscribe;
  }, [services]);

  const changeLanguage = useCallback(
    async (language: 'system' | 'zh' | 'en') => {
      await services.settings.setSetting('app-language', language);
      const resolved = resolveLocale(language);
      setLocale(resolved);
      setLocaleState(resolved);
    },
    [services],
  );

  const t = useCallback(
    (key: StringKey, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  );

  return { locale, t, changeLanguage };
}

export type { StringKey };
