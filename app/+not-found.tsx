import { Link } from 'expo-router';
import { Text, View } from 'react-native';

import { useI18n } from '@/hooks/use-i18n';

export default function NotFoundScreen() {
  const { t } = useI18n();
  return (
    <View className="flex-1 items-center justify-center gap-3 bg-paper dark:bg-paper-night">
      <Text className="text-base text-ink dark:text-ink-night">{t('notFound.title')}</Text>
      <Link href="/" className="rounded-xl bg-accent px-4 py-2">
        <Text className="font-semibold text-white">{t('notFound.back')}</Text>
      </Link>
    </View>
  );
}
