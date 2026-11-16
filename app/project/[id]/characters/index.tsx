import { Text, View } from 'react-native';

/** 角色中心占位（docs/plan.md 4.1.4）：LLM 抽取候选 → 人工确认 → 绑定音色，随 P2 落地。 */
export default function CharactersScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-zinc-50 px-6 dark:bg-zinc-950">
      <Text className="text-center text-sm text-zinc-500 dark:text-zinc-400">
        角色候选与人工确认随 P2 落地：LLM 抽取角色与归属 → 候选审阅 → 绑定 Edge TTS 音色。
        人工保护规则已在 domain/binding.ts 冻结。
      </Text>
    </View>
  );
}
