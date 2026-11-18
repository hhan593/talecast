import { Link } from 'expo-router';
import { Text, View } from 'react-native';

export default function NotFoundScreen() {
  return (
    <View className="flex-1 items-center justify-center gap-3 bg-paper dark:bg-paper-night">
      <Text className="text-base text-ink dark:text-ink-night">页面不存在或已被移除</Text>
      <Link href="/" className="rounded-xl bg-accent px-4 py-2">
        <Text className="font-semibold text-white">返回书架</Text>
      </Link>
    </View>
  );
}
