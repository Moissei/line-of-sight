import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
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

  const [auth, setAuth] = useState({ ready: false, signedIn: false, generation: 0 });
  useEffect(() => {
    let previousUser: string | null = null;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUser = session?.user.id ?? null;
      const reset = event === 'SIGNED_OUT' || (previousUser !== null && previousUser !== nextUser);
      previousUser = nextUser;
      setAuth((current) => ({ ready: true, signedIn: !!session, generation: current.generation + (reset ? 1 : 0) }));
      // Do not await Supabase APIs inside an Auth callback.
      if (reset) setTimeout(() => { void supabase.removeAllChannels().catch(() => {}); }, 0);
    });
    return () => data.subscription.unsubscribe();
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
  if (!fontsLoaded || !auth.ready) return null;

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <OnboardingProvider key={auth.generation}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="sign-up" />
          <Stack.Protected guard={auth.signedIn}>
            <Stack.Screen name="discovery" />
            <Stack.Screen name="account" />
            <Stack.Screen name="create-profile" />
            <Stack.Screen name="edit-profile" />
            <Stack.Screen name="intentions" />
            <Stack.Screen name="requests" />
            <Stack.Screen name="connections" />
            <Stack.Screen name="connection-detail" />
            <Stack.Screen name="explore" />
          </Stack.Protected>
        </Stack>
      </OnboardingProvider>
    </ThemeProvider>
  );
}
