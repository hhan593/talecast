import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Alert } from 'react-native';
import { useServices } from '@/container';
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
        setNotice('端点与模型名不能为空');
        return;
      }
      await services.settings.saveLlmConfig({ endpoint, model, apiKey });
      setApiKey(''); // 不回显密钥
      await reload();
      setNotice('已保存。密钥只存系统安全存储，不写入数据库与日志。');
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
          用于角色抽取与书籍助手。原文会发送给该服务商（docs/plan.md 风险表）。
        </Text>
        {loading ? (
          <ActivityIndicator className="mt-4" />
        ) : (
          <View className="mt-3 gap-3">
            <View>
              <Text className="mb-1 text-xs text-muted">端点 Base URL</Text>
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
              <Text className="mb-1 text-xs text-muted">模型名</Text>
              <TextInput
                className="rounded-lg border border-line px-3 py-2 text-sm text-ink dark:border-line-night dark:text-ink-night"
                value={model}
                onChangeText={setModel}
                placeholder="例如 qwen-max / glm-4 等"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View>
              <Text className="mb-1 text-xs text-muted">
                API Key（{hasApiKey ? '已设置；留空则不修改' : '未设置'}）
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
              <Text className="font-semibold text-white">保存服务连接</Text>
            </Pressable>
            {notice ? <Text className="text-xs text-muted dark:text-muted-night">{notice}</Text> : null}
          </View>
        )}
      </View>

      <View className="mt-3 rounded-xl bg-card p-4 dark:bg-card-night">
        <Text className="font-semibold text-ink dark:text-ink-night">{t('settings.ttsSection')}</Text>
        <Text className="mt-2 text-sm text-muted dark:text-muted-night">
          Edge TTS（免费、无需密钥）。音色库请在书籍内 角色中心 → 刷新音色库 拉取。
        </Text>
      </View>

      {usage ? (
        <View className="mt-3 rounded-xl bg-card p-4 dark:bg-card-night">
          <Text className="font-semibold text-ink dark:text-ink-night">{t('settings.usageSection')}</Text>
          <Text className="mt-2 text-sm text-muted dark:text-muted-night">
            · 语音合成（Edge）：成功 {usage.ttsOk} 次 / 失败 {usage.ttsFailed} 次{'\n'}
            · 文本模型：成功 {usage.llmOk} 次 / 失败 {usage.llmFailed} 次
          </Text>
          <Pressable accessibilityRole="button" className="mt-2 self-start" onPress={() => void reload()}>
            <Text className="text-xs text-accent">刷新</Text>
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
            ['volume-key-turn', '音量键翻页（Android，阅读器内）', volumeKeyTurn, setVolumeKeyTurn],
            ['reader-immersive', '沉浸全屏（菜单隐藏时收起状态栏）', immersive, setImmersive],
            ['reader-page-sound', '翻页音效', pageSound, setPageSound],
            ['word-karaoke', '词级卡拉OK跟随（听读逐词高亮）', wordKaraoke, setWordKaraoke],
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
                {value ? '开' : '关'}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text className="mt-2 text-xs text-faint">音量键翻页仅 Android 且阅读器翻页模式内生效。</Text>
      </View>

      {stats ? (
        <View className="mt-3 rounded-xl bg-card p-4 dark:bg-card-night">
          <Text className="font-semibold text-ink dark:text-ink-night">{t('settings.statsSection')}</Text>
          <Text className="mt-2 text-sm text-muted dark:text-muted-night">
            · 今日阅读 {Math.round(stats.todayMs / 60000)} 分钟 · {stats.todayChars} 字{'\n'}
            · 累计阅读 {Math.round(stats.totalMs / 60000)} 分钟
          </Text>
          <Pressable accessibilityRole="button" className="mt-2 self-start" onPress={() => void reload()}>
            <Text className="text-xs text-accent">刷新</Text>
          </Pressable>
        </View>
      ) : null}

      <View className="mt-3 rounded-xl bg-card p-4 dark:bg-card-night">
        <Text className="font-semibold text-ink dark:text-ink-night">{t('settings.backupSection')}</Text>
        <Text className="mt-2 text-sm text-muted dark:text-muted-night">
          导出书架+偏好+书签为 JSON 分享保存；导入恢复设置项（书籍正文需重新导入原文件）。
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
              Alert.alert('导入备份', '将覆盖当前替换净化规则、阅读偏好等设置项（LLM 密钥不受影响）。继续？', [
                { text: '取消', style: 'cancel' },
                {
                  text: '导入',
                  onPress: () => {
                    setBackupBusy(true);
                    void services.backup
                      .importFromPicker()
                      .then((result) => {
                        if (result.ok) setNotice(`已恢复 ${result.value.restoredSettings} 项设置`);
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
        <Text className="font-semibold text-ink dark:text-ink-night">错误日志（本机 JS 异常）</Text>
        <Text className="mt-2 text-sm text-muted dark:text-muted-night">
          记录最近 {crashEntries === null ? '—' : crashEntries.length} 条异常（仅本地，无上报）。
        </Text>
        <View className="mt-2 flex-row gap-2">
          <Pressable
            accessibilityRole="button"
            className="rounded-xl bg-raised px-3 py-2 dark:bg-card-night"
            onPress={() => {
              void services.crashLog.recent().then((entries) => {
                setCrashEntries(entries);
                if (entries.length === 0) {
                  Alert.alert('错误日志', '暂无记录');
                  return;
                }
                const latest = entries[entries.length - 1];
                Alert.alert(
                  `最近 1 条（共 ${entries.length} 条）`,
                  `${new Date(latest.at).toLocaleString('zh-CN')}\n[${latest.source}] ${latest.message}`,
                );
              });
            }}
          >
            <Text className="text-sm text-ink dark:text-ink-night">查看</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            className="rounded-xl bg-danger-soft px-3 py-2 dark:bg-danger-nightsoft"
            onPress={() => {
              void services.crashLog.clear().then(() => setCrashEntries([]));
            }}
          >
            <Text className="text-sm text-danger dark:text-danger-night">清空</Text>
          </Pressable>
        </View>
      </View>

      <View className="mt-3 rounded-xl bg-card p-4 dark:bg-card-night">
        <Text className="font-semibold text-ink dark:text-ink-night">{t('settings.errorBoundarySection')}</Text>
        <Text className="mt-2 text-sm text-muted dark:text-muted-night">
          · 原文文本会发送给 TTS / LLM 服务商{'\n'}
          · 生成任务仅前台运行；任务与段状态持久化，重进应用可恢复{'\n'}
          · 首版仅接受 UTF-8 编码文本；单文件 16MB、单章生成 3 万字{'\n'}
          · 数据保存在本机沙盒，无账号、无云同步
        </Text>
      </View>

      <View className="mt-3 rounded-xl bg-card p-4 dark:bg-card-night">
        <Text className="font-semibold text-ink dark:text-ink-night">通用</Text>
        <Text className="mt-2 text-sm text-muted dark:text-muted-night">TaleCast v0.10.0 · 对话分声 · 阅读器交互补齐</Text>
      </View>
    </ScrollView>
  );
}
