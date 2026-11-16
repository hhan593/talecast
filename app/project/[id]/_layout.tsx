import { Stack } from 'expo-router';

/** 工程外壳（docs/plan.md 5.5）：加载与空状态在 index 收口；审阅为 modal 人工关口。 */
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
