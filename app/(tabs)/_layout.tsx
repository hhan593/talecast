import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { useI18n } from '@/hooks/use-i18n';

export default function TabsLayout() {
  const { t, locale } = useI18n();
  return (
    <Tabs
      // expo-router 的 tabs 选项在挂载时缓存，语言切换需整体重挂才能更新标签
      key={locale}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#6366f1',
        // Workaround for Android new-arch: detached inactive screens break
        // touch delivery to the visible screen after navigation. The prop is
        // forwarded to react-native-screens but missing from the option types.
        // @ts-expect-error -- forwarded to react-native-screens at runtime
        detachInactiveScreens: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.shelf'),
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
          title: t('tabs.settings'),
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
