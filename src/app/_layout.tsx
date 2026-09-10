import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { OnboardingProvider } from '@/components/onboarding-provider';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // Temporary development-only connection check; no UI or navigation changes.
  useEffect(() => {
    if (__DEV__) {
      void import('@/lib/supabase-connection-test')
        .then(({ testSupabaseConnection }) => testSupabaseConnection())
        .catch(() => console.error('[Supabase connection test] ERROR: Could not load the development check.'));
    }
  }, []);

  const colorScheme = useColorScheme();
  const [fontsLoaded, fontError] = useFonts({
    'Tangerine-Bold': require('@/assets/fonts/Tangerine-Bold.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Let the router's error boundary report a failed asset instead of hanging on the splash.
  if (fontError) throw fontError;
  if (!fontsLoaded) return null;

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <OnboardingProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </OnboardingProvider>
    </ThemeProvider>
  );
}
