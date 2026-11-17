import { Stack } from 'expo-router';

export default function ProjectLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="characters" />
      <Stack.Screen
        name="review"
        options={{ presentation: 'modal', headerShown: true, title: '候选审阅' }}
      />
    </Stack>
  );
}
