import { Stack } from 'expo-router';

import { useI18n } from '@/hooks/use-i18n';

export default function CharactersLayout() {
  const { t } = useI18n();
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        title: t('nav.characters'),
        headerBackTitle: t('common.back'),
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="[characterId]" options={{ title: t('nav.characterDetail') }} />
    </Stack>
  );
}
