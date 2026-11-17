import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useServices } from '@/container';

/** 设置（docs/plan.md 4.2 / P4）：P2 落服务连接（LLM），密钥只进 SecureStore。 */
export default function SettingsScreen() {
  const services = useServices();
  const [loading, setLoading] = useState(true);
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
      className="flex-1 bg-zinc-50 dark:bg-zinc-950"
      contentContainerClassName="px-4 pb-10 pt-16"
    >
      <Text className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">设置</Text>

      <View className="mt-6 rounded-xl bg-white p-4 dark:bg-zinc-900">
        <Text className="font-semibold text-zinc-900 dark:text-zinc-100">服务连接 · 文本模型（OpenAI 兼容）</Text>
        <Text className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          用于角色抽取与书籍助手。原文会发送给该服务商（docs/plan.md 风险表）。
        </Text>
        {loading ? (
          <ActivityIndicator className="mt-4" />
        ) : (
          <View className="mt-3 gap-3">
            <View>
              <Text className="mb-1 text-xs text-zinc-500">端点 Base URL</Text>
              <TextInput
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
                value={endpoint}
                onChangeText={setEndpoint}
                placeholder="https://api.example.com/v1"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View>
              <Text className="mb-1 text-xs text-zinc-500">模型名</Text>
              <TextInput
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
                value={model}
                onChangeText={setModel}
                placeholder="例如 qwen-max / glm-4 等"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View>
              <Text className="mb-1 text-xs text-zinc-500">
                API Key（{hasApiKey ? '已设置；留空则不修改' : '未设置'}）
              </Text>
              <TextInput
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
                value={apiKey}
                onChangeText={setApiKey}
                placeholder={hasApiKey ? '••••••••' : 'sk-...'}
                secureTextEntry
                autoCapitalize="none"
              />
            </View>
            <Pressable className="items-center rounded-xl bg-indigo-500 py-2.5 active:bg-indigo-600" onPress={save}>
              <Text className="font-semibold text-white">保存服务连接</Text>
            </Pressable>
            {notice ? <Text className="text-xs text-zinc-500 dark:text-zinc-400">{notice}</Text> : null}
          </View>
        )}
      </View>

      <View className="mt-3 rounded-xl bg-white p-4 dark:bg-zinc-900">
        <Text className="font-semibold text-zinc-900 dark:text-zinc-100">语音生成</Text>
        <Text className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Edge TTS（免费、无需密钥）。音色库请在书籍内 角色中心 → 刷新音色库 拉取。
        </Text>
      </View>

      {usage ? (
        <View className="mt-3 rounded-xl bg-white p-4 dark:bg-zinc-900">
          <Text className="font-semibold text-zinc-900 dark:text-zinc-100">请求用量（本机累计）</Text>
          <Text className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            · 语音合成（Edge）：成功 {usage.ttsOk} 次 / 失败 {usage.ttsFailed} 次{'\n'}
            · 文本模型：成功 {usage.llmOk} 次 / 失败 {usage.llmFailed} 次
          </Text>
          <Pressable className="mt-2 self-start" onPress={() => void reload()}>
            <Text className="text-xs text-indigo-500">刷新</Text>
          </Pressable>
        </View>
      ) : null}

      <View className="mt-3 rounded-xl bg-white p-4 dark:bg-zinc-900">
        <Text className="font-semibold text-zinc-900 dark:text-zinc-100">能力边界</Text>
        <Text className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          · 原文文本会发送给 TTS / LLM 服务商{'\n'}
          · 生成任务仅前台运行；任务与段状态持久化，重进应用可恢复{'\n'}
          · 首版仅接受 UTF-8 编码文本；单文件 16MB、单章生成 3 万字{'\n'}
          · 数据保存在本机沙盒，无账号、无云同步
        </Text>
      </View>

      <View className="mt-3 rounded-xl bg-white p-4 dark:bg-zinc-900">
        <Text className="font-semibold text-zinc-900 dark:text-zinc-100">通用</Text>
        <Text className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">TaleCast 0.1.0 · P4 加固原型</Text>
      </View>
    </ScrollView>
  );
}
