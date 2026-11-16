import { ScrollView, Text, View } from 'react-native';

/** 设置（docs/plan.md 4.2 / P4）：P0 只落结构与能力边界文案；密钥与用量随 P4 接入。 */
export default function SettingsScreen() {
  return (
    <ScrollView
      className="flex-1 bg-zinc-50 dark:bg-zinc-950"
      contentContainerClassName="px-4 pb-10 pt-16"
    >
      <Text className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">设置</Text>

      <View className="mt-6 rounded-xl bg-white p-4 dark:bg-zinc-900">
        <Text className="font-semibold text-zinc-900 dark:text-zinc-100">通用</Text>
        <Text className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          TaleCast 0.1.0 · P0 数据底座原型
        </Text>
      </View>

      <View className="mt-3 rounded-xl bg-white p-4 dark:bg-zinc-900">
        <Text className="font-semibold text-zinc-900 dark:text-zinc-100">服务连接</Text>
        <Text className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          LLM 密钥将在 P4 接入 Secure Store（绝不明文入库/入日志）；当前未配置，助手与角色抽取不可用。
          语音生成走 Edge TTS，无需任何密钥。
        </Text>
      </View>

      <View className="mt-3 rounded-xl bg-white p-4 dark:bg-zinc-900">
        <Text className="font-semibold text-zinc-900 dark:text-zinc-100">能力边界</Text>
        <Text className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          · 原文文本会发送给 TTS / LLM 服务商（docs/plan.md 风险表）{'\n'}
          · 生成任务仅前台运行；任务与段状态持久化，重进应用可恢复{'\n'}
          · 首版仅接受 UTF-8 编码文本{'\n'}
          · 数据保存在本机沙盒，无账号、无云同步
        </Text>
      </View>
    </ScrollView>
  );
}
