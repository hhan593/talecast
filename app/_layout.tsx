import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { ServicesProvider } from '@/container';
import '../global.css';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider value={theme}>
      <ServicesProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="project/[id]" />
        </Stack>
      </ServicesProvider>
    </ThemeProvider>
  );
}
