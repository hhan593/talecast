import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';

import { useServices } from '@/container';
import Constants from 'expo-constants';

import { useI18n } from '@/hooks/use-i18n';
import { useUpdatePrompt } from '@/hooks/use-update-prompt';

/** 与 services/stats.ReadingStats 同构（架构守卫：app 不 import services，类型本地投影） */
interface ReadingStats {
  todayMs: number;
  todayChars: number;
  totalMs: number;
  date: string;
}

/**
 * 设置页重构（issue #60）：信息结构按「通用 / 阅读 / 数据 / 服务」四组分区，
 * 分组小标签 + 卡片列表的主流阅读 App 版式；LLM 服务连接默认折叠（普通
 * 阅读用户不碰，展开才见表单）；能力边界与版本号降为底部脚注。
 * 功能单元与重构前一一对应：语言切换、检查更新、阅读开关、统计、备份、
 * 错误日志、用量、LLM 配置（密钥只进 SecureStore）。
 */
export default function SettingsScreen() {
  const services = useServices();
  const { t, changeLanguage } = useI18n();
  const { checkAndPrompt } = useUpdatePrompt();
  const colorScheme = useColorScheme();
  const inkColor = colorScheme === 'dark' ? '#EAE3D5' : '#2C2822';
  const [updateChecking, setUpdateChecking] = useState(false);
  const [stats, setStats] = useState<ReadingStats | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [volumeKeyTurn, setVolumeKeyTurn] = useState(false);
  const [immersive, setImmersive] = useState(true);
  const [pageSound, setPageSound] = useState(false);
  const [wordKaraoke, setWordKaraoke] = useState(false);
  const [allowRotation, setAllowRotation] = useState(false);
  // 听书自动化开关（issue #99）：默认开，维持既有行为；关闭即停在当前章
  const [autoNext, setAutoNext] = useState(true);
  const [autoPregen, setAutoPregen] = useState(true);
  const [appLanguage, setAppLanguage] = useState<'system' | 'zh' | 'en'>('system');
  const [crashEntries, setCrashEntries] = useState<Array<{ at: number; source: string; message: string }> | null>(null);
  const [endpoint, setEndpoint] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ ttsOk: number; ttsFailed: number; llmOk: number; llmFailed: number } | null>(null);
  // 服务连接默认折叠：只读用户不碰 LLM 配置，展开才见表单（issue #60）
  const [svcOpen, setSvcOpen] = useState(false);

  const reload = useCallback(async () => {
    const config = await services.settings.getLlmConfig();
    setEndpoint(config.endpoint ?? '');
    setModel(config.model ?? '');
    setHasApiKey(config.hasApiKey);
    setUsage(await services.settings.getUsage());
    setStats(await services.stats.getStats());
    setVolumeKeyTurn((await services.settings.getSetting('volume-key-turn')) === 'on');
    setImmersive((await services.settings.getSetting('reader-immersive')) !== 'off');
    setPageSound((await services.settings.getSetting('reader-page-sound')) === 'on');
    setWordKaraoke((await services.settings.getSetting('word-karaoke')) === 'on');
    setAllowRotation((await services.settings.getSetting('reader-allow-rotation')) === 'on');
    setAutoNext((await services.settings.getSetting('auto-next-chapter')) !== 'off');
    setAutoPregen((await services.settings.getSetting('auto-pregen-next')) !== 'off');
    const lang = await services.settings.getSetting('app-language');
    setAppLanguage(lang === 'zh' || lang === 'en' ? lang : 'system');
    void services.crashLog.recent().then(setCrashEntries);
    setLoading(false);
  }, [services]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(() => {
    void (async () => {
      if (endpoint.trim().length === 0 || model.trim().length === 0) {
        setNotice(t('settings.endpointRequired'));
        return;
      }
      await services.settings.saveLlmConfig({ endpoint, model, apiKey });
      setApiKey(''); // 不回显密钥
      await reload();
      setNotice(t('settings.saved'));
    })();
  }, [endpoint, model, apiKey, reload, services]);

  /** 分组小标签：卡片上方的浅色组名（主流设置页版式） */
  const sectionLabel = (label: string) => (
    <Text className="mb-1.5 mt-6 text-xs font-semibold tracking-wide text-faint">{label}</Text>
  );

  /** 开关行：label 开/关，写回经 setter + settings 持久化 */
  const toggleRow = (key: string, label: string, value: boolean, setter: (next: boolean) => void) => (
    <Pressable
      key={key}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      className="flex-row items-center justify-between rounded-lg bg-raised px-3 py-2.5 dark:bg-card-night"
      onPress={() => {
        const next = !value;
        setter(next);
        void services.settings.setSetting(key, next ? 'on' : 'off');
      }}
    >
      <Text className="flex-1 text-sm text-ink dark:text-ink-night">{label}</Text>
      <Text className={`text-xs font-semibold ${value ? 'text-accent' : 'text-faint'}`}>
        {value ? t('common.on') : t('common.off')}
      </Text>
    </Pressable>
  );

  return (
    <ScrollView
      className="flex-1 bg-paper dark:bg-paper-night"
      contentContainerClassName="px-4 pb-10 pt-16"
    >
      <Text className="text-2xl font-bold text-ink dark:text-ink-night">{t('settings.title')}</Text>

      {/* ── 通用：语言 / 检查更新 ─────────────────────────── */}
      {sectionLabel(t('settings.general'))}
      <View className="rounded-xl bg-card p-4 dark:bg-card-night">
        <Text className="mb-2 text-xs text-muted">{t('settings.languageSection')}</Text>
        <View className="flex-row gap-2">
          {(['system', 'zh', 'en'] as const).map((lang) => (
            <Pressable
              key={lang}
              accessibilityRole="button"
              accessibilityState={{ selected: appLanguage === lang }}
              className={`flex-1 items-center rounded-xl py-2.5 ${
                appLanguage === lang ? 'bg-accent' : 'bg-raised dark:bg-card-night'
              }`}
              onPress={() => {
                setAppLanguage(lang);
                void changeLanguage(lang);
              }}
            >
              <Text
                className={`text-sm ${appLanguage === lang ? 'font-semibold text-white' : 'text-ink dark:text-ink-night'}`}
              >
                {lang === 'system' ? t('settings.languageSystem') : lang === 'zh' ? '中文' : 'English'}
              </Text>
            </Pressable>
          ))}
        </View>
        {Platform.OS === 'android' ? (
          <Pressable
            accessibilityRole="button"
            className="mt-2 flex-row items-center justify-between rounded-lg bg-raised px-3 py-2.5 dark:bg-card-night"
            onPress={() => {
              setUpdateChecking(true);
              void checkAndPrompt({ manual: true }).finally(() => setUpdateChecking(false));
            }}
          >
            <Text className="flex-1 text-sm text-ink dark:text-ink-night">{t('settings.updateCheck')}</Text>
            {updateChecking ? (
              <ActivityIndicator size="small" />
            ) : (
              <Text className="text-xs text-faint">v{Constants.expoConfig?.version ?? '—'}</Text>
            )}
          </Pressable>
        ) : null}
      </View>

      {/* ── 阅读：阅读器全局开关 ─────────────────────────── */}
      {sectionLabel(t('settings.readingSection'))}
      <View className="rounded-xl bg-card p-4 dark:bg-card-night">
        <View className="gap-2">
          {([
            ['volume-key-turn', t('settings.readingVolumeKey'), volumeKeyTurn, setVolumeKeyTurn],
            ['reader-immersive', t('settings.readingImmersive'), immersive, setImmersive],
            ['reader-page-sound', t('settings.readingPageSound'), pageSound, setPageSound],
            ['word-karaoke', t('settings.readingKaraoke'), wordKaraoke, setWordKaraoke],
            ['reader-allow-rotation', t('settings.readingRotation'), allowRotation, setAllowRotation],
            ['auto-next-chapter', t('settings.autoNextChapter'), autoNext, setAutoNext],
            ['auto-pregen-next', t('settings.autoPregenNext'), autoPregen, setAutoPregen],
          ] as const).map(([key, label, value, setter]) => toggleRow(key, label, value, setter))}
        </View>
        <Text className="mt-2 text-xs text-faint">{t('settings.readingHint')}</Text>
      </View>

      {/* ── 数据：统计 / 备份 / 错误日志 ─────────────────── */}
      {sectionLabel(t('settings.dataSection'))}
      <View className="rounded-xl bg-card p-4 dark:bg-card-night">
        {stats ? (
          <View className="mb-3">
            <Text className="text-sm text-muted dark:text-muted-night">
              {t('settings.statsToday', { minutes: Math.round(stats.todayMs / 60000), chars: stats.todayChars })}
            </Text>
            <Text className="mt-1 text-sm text-muted dark:text-muted-night">
              {t('settings.statsTotal', { minutes: Math.round(stats.totalMs / 60000) })}
            </Text>
          </View>
        ) : null}
        <View className="flex-row gap-2">
          <Pressable accessibilityRole="button"
            className="flex-1 items-center rounded-xl bg-accent py-2.5 active:bg-accent-deep"
            disabled={backupBusy}
            onPress={() => {
              setBackupBusy(true);
              void services.backup
                .exportAndShare()
                .then((result) => {
                  if (!result.ok) setNotice(result.error.message);
                })
                .finally(() => setBackupBusy(false));
            }}
          >
            <Text className="font-semibold text-white">{t('settings.exportBackup')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button"
            className="flex-1 items-center rounded-xl bg-raised py-2.5 dark:bg-card-night"
            disabled={backupBusy}
            onPress={() => {
              Alert.alert(t('settings.importBackupTitle'), t('settings.importBackupConfirm'), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('settings.importAction'),
                  onPress: () => {
                    setBackupBusy(true);
                    void services.backup
                      .importFromPicker()
                      .then((result) => {
                        if (result.ok) {
                          const v = result.value;
                          let message = t('settings.restored', { count: v.restoredSettings });
                          if (v.restoredBookmarks > 0 || v.restoredAnnotations > 0 || v.skippedAnnotations > 0) {
                            message += t('settings.restoredData', {
                              bookmarks: v.restoredBookmarks,
                              annotations: v.restoredAnnotations,
                              skipped: v.skippedAnnotations,
                            });
                          }
                          setNotice(message);
                        } else setNotice(result.error.message);
                      })
                      .finally(() => setBackupBusy(false));
                  },
                },
              ]);
            }}
          >
            <Text className="text-sm text-ink dark:text-ink-night">{t('settings.importBackup')}</Text>
          </Pressable>
        </View>
        <Text className="mt-2 text-xs text-faint">{t('settings.backupHint')}</Text>
        {/* 备份/恢复反馈就近展示：LLM 折叠时也不可见性丢失（#77） */}
        {notice ? <Text className="mt-2 text-xs text-muted dark:text-muted-night">{notice}</Text> : null}

        <View className="mt-3 flex-row items-center justify-between rounded-lg bg-raised px-3 py-2.5 dark:bg-card-night">
          <Text className="flex-1 text-sm text-ink dark:text-ink-night">
            {t('settings.crashCount', { count: crashEntries === null ? '—' : crashEntries.length })}
          </Text>
          <Pressable
            accessibilityRole="button"
            className="mr-2 rounded-lg bg-card px-3 py-1.5 dark:bg-raised-night"
            onPress={() => {
              void services.crashLog.recent().then((entries) => {
                setCrashEntries(entries);
                if (entries.length === 0) {
                  Alert.alert(t('settings.crashTitle'), t('settings.crashEmpty'));
                  return;
                }
                const latest = entries[entries.length - 1];
                Alert.alert(
                  t('settings.crashRecent', { count: entries.length }),
                  `${new Date(latest.at).toLocaleString('zh-CN')}\n[${latest.source}] ${latest.message}`,
                );
              });
            }}
          >
            <Text className="text-xs text-ink dark:text-ink-night">{t('settings.crashView')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('settings.crashClear')}
            className="rounded-lg bg-danger-soft px-3 py-1.5 dark:bg-danger-nightsoft"
            onPress={() => {
              void services.crashLog.clear().then(() => setCrashEntries([]));
            }}
          >
            <Ionicons name="trash-outline" size={14} color={colorScheme === 'dark' ? '#E08A8A' : '#B5442D'} />
          </Pressable>
        </View>
      </View>

      {/* ── 服务：语音生成 / 用量 / 文本模型（默认折叠） ──── */}
      {sectionLabel(t('settings.serviceSection'))}
      <View className="rounded-xl bg-card p-4 dark:bg-card-night">
        <Text className="text-sm text-muted dark:text-muted-night">{t('settings.ttsHint')}</Text>
        {usage ? (
          <View className="mt-3 rounded-lg bg-raised px-3 py-2.5 dark:bg-card-night">
            <Text className="text-xs text-muted dark:text-muted-night">
              {t('settings.usageTts', { ok: usage.ttsOk, failed: usage.ttsFailed })}
            </Text>
            <Text className="mt-1 text-xs text-muted dark:text-muted-night">
              {t('settings.usageLlm', { ok: usage.llmOk, failed: usage.llmFailed })}
            </Text>
            <Pressable accessibilityRole="button" className="mt-1.5 self-start" onPress={() => void reload()}>
              <Text className="text-xs text-accent">{t('settings.refresh')}</Text>
            </Pressable>
          </View>
        ) : null}

        {/* 服务连接（LLM）：默认折叠，头部行展示配置状态 */}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: svcOpen }}
          className="mt-3 flex-row items-center justify-between rounded-lg bg-raised px-3 py-2.5 dark:bg-card-night"
          onPress={() => setSvcOpen((prev) => !prev)}
        >
          <Text className="flex-1 text-sm text-ink dark:text-ink-night">{t('settings.llmSection')}</Text>
          <Text className={`mr-2 text-xs ${hasApiKey ? 'text-accent' : 'text-faint'}`}>
            {hasApiKey ? t('settings.apiKeySet') : t('settings.apiKeyUnset')}
          </Text>
          <Ionicons
            name={svcOpen ? 'chevron-down' : 'chevron-forward'}
            size={14}
            color={colorScheme === 'dark' ? '#8C8272' : '#B5442D'}
          />
        </Pressable>
        {svcOpen ? (
          loading ? (
            <ActivityIndicator className="mt-3" />
          ) : (
            <View className="mt-3 gap-3">
              <Text className="text-xs text-muted dark:text-muted-night">{t('settings.llmHint')}</Text>
              <View>
                <Text className="mb-1 text-xs text-muted">{t('settings.endpoint')}</Text>
                <TextInput
                  className="rounded-lg border border-line px-3 py-2 text-sm text-ink dark:border-line-night dark:text-ink-night"
                  value={endpoint}
                  onChangeText={setEndpoint}
                  placeholder="https://api.example.com/v1"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <View>
                <Text className="mb-1 text-xs text-muted">{t('settings.model')}</Text>
                <TextInput
                  className="rounded-lg border border-line px-3 py-2 text-sm text-ink dark:border-line-night dark:text-ink-night"
                  value={model}
                  onChangeText={setModel}
                  placeholder={t('settings.modelPlaceholder')}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <View>
                <Text className="mb-1 text-xs text-muted">
                  {t('settings.apiKeyState', {
                    state: hasApiKey ? t('settings.apiKeySet') : t('settings.apiKeyUnset'),
                  })}
                </Text>
                <TextInput
                  className="rounded-lg border border-line px-3 py-2 text-sm text-ink dark:border-line-night dark:text-ink-night"
                  value={apiKey}
                  onChangeText={setApiKey}
                  placeholder={hasApiKey ? '••••••••' : 'sk-...'}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </View>
              <Pressable accessibilityRole="button" className="items-center rounded-xl bg-accent py-2.5 active:bg-accent-deep" onPress={save}>
                <Text className="font-semibold text-white">{t('settings.save')}</Text>
              </Pressable>
              {notice ? <Text className="text-xs text-muted dark:text-muted-night">{notice}</Text> : null}
            </View>
          )
        ) : null}
      </View>

      {/* ── 脚注：能力边界 + 版本 ─────────────────────────── */}
      <Text className="mt-6 text-xs leading-5 text-faint">
        {`${t('settings.capTextToProvider')}\n${t('settings.capForeground')}\n${t('settings.capEncodings')}\n${t('settings.capLocal')}`}
      </Text>
      <Text className="mt-2 text-xs text-faint">
        {t('settings.versionLine', { version: Constants.expoConfig?.version ?? '—' })}
      </Text>
    </ScrollView>
  );
}
