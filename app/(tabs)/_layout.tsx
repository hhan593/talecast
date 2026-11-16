import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

/** 双 Tab（docs/plan.md 5.5）：书架 / 设置。"制作"经书架打开工程进入，不设为 Tab。 */
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: '#6366f1' }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '书架',
          tabBarIcon: ({ color, size }) => (
            <Ionicons
              name="book-outline"
              color={typeof color === 'string' ? color : undefined}
              size={typeof size === 'number' ? size : 24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '设置',
          tabBarIcon: ({ color, size }) => (
            <Ionicons
              name="settings-outline"
              color={typeof color === 'string' ? color : undefined}
              size={typeof size === 'number' ? size : 24}
            />
          ),
        }}
      />
    </Tabs>
  );
}
