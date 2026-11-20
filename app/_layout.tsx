import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useEffect } from 'react';
import { Platform, useColorScheme } from 'react-native';

import { ErrorBoundary } from '@/components/error-boundary';
import { ServicesProvider, useServices } from '@/container';
import { useUpdatePrompt } from '@/hooks/use-update-prompt';
import '../global.css';

/** 启动静默检查更新（issue #58，仅 Android）：发现新版本弹窗提示，失败/无更新不打扰 */
function StartupUpdateCheck() {
  const services = useServices();
  const { checkAndPrompt } = useUpdatePrompt();
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    // 启动静默检查：24h 节流在 service 内部；此处只消费结果
    void checkAndPrompt({ manual: false }).catch(() => undefined);
  }, [services, checkAndPrompt]);
  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <ErrorBoundary>
      <ThemeProvider value={theme}>
        <ServicesProvider>
          <StartupUpdateCheck />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="project/[id]" />
          </Stack>
        </ServicesProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
