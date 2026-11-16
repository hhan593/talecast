import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

/** 角色详情占位：身份/绑定/画像/建议对照随 P2 落地。 */
export default function CharacterDetailScreen() {
  const params = useLocalSearchParams<{ characterId: string }>();
  return (
    <View className="flex-1 items-center justify-center bg-zinc-50 px-6 dark:bg-zinc-950">
      <Text className="text-center text-sm text-zinc-500 dark:text-zinc-400">
        角色详情占位（{params.characterId}）：身份确认、音色绑定与建议对照随 P2 落地。
      </Text>
    </View>
  );
}
