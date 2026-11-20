import { Stack } from 'expo-router';

import { useI18n } from '@/hooks/use-i18n';

export default function ProjectLayout() {
  const { t } = useI18n();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="characters" />
      <Stack.Screen
        name="review"
        options={{ presentation: 'modal', headerShown: true, title: t('nav.review') }}
      />
    </Stack>
  );
}
