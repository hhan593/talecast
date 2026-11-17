import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

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
