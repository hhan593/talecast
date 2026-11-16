import { Link } from 'expo-router';
import { Text, View } from 'react-native';

export default function NotFoundScreen() {
  return (
    <View className="flex-1 items-center justify-center gap-3 bg-zinc-50 dark:bg-zinc-950">
      <Text className="text-base text-zinc-700 dark:text-zinc-300">页面不存在或已被移除</Text>
      <Link href="/" className="rounded-xl bg-indigo-500 px-4 py-2">
        <Text className="font-semibold text-white">返回书架</Text>
      </Link>
    </View>
  );
}
