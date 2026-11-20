import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Alert } from 'react-native';
import { useServices } from '@/container';
import Constants from 'expo-constants';

import { useI18n } from '@/hooks/use-i18n';

/** 与 services/stats.ReadingStats 同构（架构守卫：app 不 import services，类型本地投影） */
interface ReadingStats {
  todayMs: number;
  todayChars: number;
  totalMs: number;
  date: string;
}

/** 设置（docs/plan.md 4.2 / P4）：服务连接（LLM），密钥只进 SecureStore。 */
export default function SettingsScreen() {
  const services = useServices();
  const { t, changeLanguage } = useI18n();
  const [stats, setStats] = useState<ReadingStats | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [volumeKeyTurn, setVolumeKeyTurn] = useState(false);
  const [immersive, setImmersive] = useState(true);
  const [pageSound, setPageSound] = useState(false);
  const [wordKaraoke, setWordKaraoke] = useState(false);
  const [appLanguage, setAppLanguage] = useState<'system' | 'zh' | 'en'>('system');
  const [crashEntries, setCrashEntries] = useState<Array<{ at: number; source: string; message: string }> | null>(null);
  const [endpoint, setEndpoint] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ ttsOk: number; ttsFailed: number; llmOk: number; llmFailed: number } | null>(null);

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

  return (
    <ScrollView
      className="flex-1 bg-paper dark:bg-paper-night"
      contentContainerClassName="px-4 pb-10 pt-16"
    >
      <Text className="text-2xl font-bold text-ink dark:text-ink-night">{t('settings.title')}</Text>

      <View className="mt-6 rounded-xl bg-card p-4 dark:bg-card-night">
        <Text className="font-semibold text-ink dark:text-ink-night">{t('settings.llmSection')}</Text>
        <Text className="mt-1 text-xs text-muted dark:text-muted-night">
          {t('settings.llmHint')}
        </Text>
        {loading ? (
          <ActivityIndicator className="mt-4" />
        ) : (
          <View className="mt-3 gap-3">
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
        )}
      </View>

      <View className="mt-3 rounded-xl bg-card p-4 dark:bg-card-night">
        <Text className="font-semibold text-ink dark:text-ink-night">{t('settings.ttsSection')}</Text>
        <Text className="mt-2 text-sm text-muted dark:text-muted-night">
          {t('settings.ttsHint')}
        </Text>
      </View>

      {usage ? (
        <View className="mt-3 rounded-xl bg-card p-4 dark:bg-card-night">
          <Text className="font-semibold text-ink dark:text-ink-night">{t('settings.usageSection')}</Text>
          <Text className="mt-2 text-sm text-muted dark:text-muted-night">
            {t('settings.usageTts', { ok: usage.ttsOk, failed: usage.ttsFailed })}{'\n'}
            {t('settings.usageLlm', { ok: usage.llmOk, failed: usage.llmFailed })}
          </Text>
          <Pressable accessibilityRole="button" className="mt-2 self-start" onPress={() => void reload()}>
            <Text className="text-xs text-accent">{t('settings.refresh')}</Text>
          </Pressable>
        </View>
      ) : null}

      <View className="mt-3 rounded-xl bg-card p-4 dark:bg-card-night">
        <Text className="font-semibold text-ink dark:text-ink-night">{t('settings.languageSection')}</Text>
        <View className="mt-3 flex-row gap-2">
          {(['system', 'zh', 'en'] as const).map((lang) => (
            <Pressable
              key={lang}
              accessibilityRole="button"
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
      </View>

      <View className="mt-3 rounded-xl bg-card p-4 dark:bg-card-night">
        <Text className="font-semibold text-ink dark:text-ink-night">{t('settings.readingSection')}</Text>
        <View className="mt-3 gap-2">
          {([
            ['volume-key-turn', t('settings.readingVolumeKey'), volumeKeyTurn, setVolumeKeyTurn],
            ['reader-immersive', t('settings.readingImmersive'), immersive, setImmersive],
            ['reader-page-sound', t('settings.readingPageSound'), pageSound, setPageSound],
            ['word-karaoke', t('settings.readingKaraoke'), wordKaraoke, setWordKaraoke],
          ] as const).map(([key, label, value, setter]) => (
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
          ))}
        </View>
        <Text className="mt-2 text-xs text-faint">{t('settings.readingHint')}</Text>
      </View>

      {stats ? (
        <View className="mt-3 rounded-xl bg-card p-4 dark:bg-card-night">
          <Text className="font-semibold text-ink dark:text-ink-night">{t('settings.statsSection')}</Text>
          <Text className="mt-2 text-sm text-muted dark:text-muted-night">
            {t('settings.statsToday', { minutes: Math.round(stats.todayMs / 60000), chars: stats.todayChars })}{'\n'}
            {t('settings.statsTotal', { minutes: Math.round(stats.totalMs / 60000) })}
          </Text>
          <Pressable accessibilityRole="button" className="mt-2 self-start" onPress={() => void reload()}>
            <Text className="text-xs text-accent">{t('settings.refresh')}</Text>
          </Pressable>
        </View>
      ) : null}

      <View className="mt-3 rounded-xl bg-card p-4 dark:bg-card-night">
        <Text className="font-semibold text-ink dark:text-ink-night">{t('settings.backupSection')}</Text>
        <Text className="mt-2 text-sm text-muted dark:text-muted-night">
          {t('settings.backupHint')}
        </Text>
        <View className="mt-3 flex-row gap-2">
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
                        if (result.ok) setNotice(t('settings.restored', { count: result.value.restoredSettings }));
                        else setNotice(result.error.message);
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
      </View>

      <View className="mt-3 rounded-xl bg-card p-4 dark:bg-card-night">
        <Text className="font-semibold text-ink dark:text-ink-night">{t('settings.crashSection')}</Text>
        <Text className="mt-2 text-sm text-muted dark:text-muted-night">
          {t('settings.crashCount', { count: crashEntries === null ? '—' : crashEntries.length })}
        </Text>
        <View className="mt-2 flex-row gap-2">
          <Pressable
            accessibilityRole="button"
            className="rounded-xl bg-raised px-3 py-2 dark:bg-card-night"
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
            <Text className="text-sm text-ink dark:text-ink-night">{t('settings.crashView')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            className="rounded-xl bg-danger-soft px-3 py-2 dark:bg-danger-nightsoft"
            onPress={() => {
              void services.crashLog.clear().then(() => setCrashEntries([]));
            }}
          >
            <Text className="text-sm text-danger dark:text-danger-night">{t('settings.crashClear')}</Text>
          </Pressable>
        </View>
      </View>

      <View className="mt-3 rounded-xl bg-card p-4 dark:bg-card-night">
        <Text className="font-semibold text-ink dark:text-ink-night">{t('settings.errorBoundarySection')}</Text>
        <Text className="mt-2 text-sm text-muted dark:text-muted-night">
          {t('settings.capTextToProvider')}{'\n'}
          {t('settings.capForeground')}{'\n'}
          {t('settings.capEncodings')}{'\n'}
          {t('settings.capLocal')}
        </Text>
      </View>

      <View className="mt-3 rounded-xl bg-card p-4 dark:bg-card-night">
        <Text className="font-semibold text-ink dark:text-ink-night">{t('settings.general')}</Text>
        <Text className="mt-2 text-sm text-muted dark:text-muted-night">{t('settings.versionLine', { version: Constants.expoConfig?.version ?? '—' })}</Text>
      </View>
    </ScrollView>
  );
}
