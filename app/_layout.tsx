import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform, useColorScheme } from 'react-native';

import { ErrorBoundary } from '@/components/error-boundary';
import { ServicesProvider, useServices, warmUpDatabaseAsync } from '@/container';
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

/**
 * web 专属门（issue #93）：expo-sqlite 的 worker 异步加载 wasm，
 * container 首次装配的同步 openDatabase 必须等 worker 就绪；
 * 原生端 worker 不存在，直接渲染。
 */
function WebSqliteGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(Platform.OS !== 'web');
  useEffect(() => {
    if (ready) return;
    void (async () => {
      await warmUpDatabaseAsync();
      setReady(true);
    })().catch(() => setReady(true)); // 失败也放行，让真实错误浮出到错误浮层
  }, [ready]);
  return ready ? <>{children}</> : null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <ErrorBoundary>
      <ThemeProvider value={theme}>
        <WebSqliteGate>
        <ServicesProvider>
          <StartupUpdateCheck />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="project/[id]" />
          </Stack>
        </ServicesProvider>
        </WebSqliteGate>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
