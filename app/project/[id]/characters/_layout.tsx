import { Stack } from 'expo-router';

export default function CharactersLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        title: '角色中心',
        headerBackTitle: '返回',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="[characterId]" options={{ title: '角色详情' }} />
    </Stack>
  );
}
