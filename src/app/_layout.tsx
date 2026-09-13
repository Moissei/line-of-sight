import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useColorScheme } from 'react-native';
import { OnboardingProvider } from '@/components/onboarding-provider';
import { isAccountDeleted, onAccountDeleted, resetDeletedAccount } from '@/lib/delete-account';
import { usePushNotifications } from '@/lib/use-push-notifications';

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
    const unsubscribeDeletion = onAccountDeleted(() => {
      setAuth(current => ({ ready: true, signedIn: false, generation: current.generation + 1 }));
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') resetDeletedAccount();
      const nextUser = session?.user.id ?? null;
      const reset = event === 'SIGNED_OUT' || (previousUser !== null && previousUser !== nextUser);
      previousUser = nextUser;
      setAuth((current) => ({ ready: true, signedIn: !!session && !isAccountDeleted(), generation: current.generation + (reset ? 1 : 0) }));
      // Do not await Supabase APIs inside an Auth callback.
      if (reset) setTimeout(() => { void supabase.removeAllChannels().catch(() => {}); }, 0);
    });
    return () => { unsubscribeDeletion(); data.subscription.unsubscribe(); };
  }, []);

  const colorScheme = useColorScheme();
  const [fontsLoaded, fontError] = useFonts({
    'Tangerine-Bold': require('@/assets/fonts/Tangerine-Bold.ttf'),
  });
  usePushNotifications(auth.ready && auth.signedIn && fontsLoaded, auth.generation);

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
          <Stack.Screen name="auth-callback" />
          <Stack.Screen name="sign-up" />
          <Stack.Protected guard={auth.signedIn}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="account" />
            <Stack.Screen name="create-profile" />
            <Stack.Screen name="intentions" />
            <Stack.Screen name="connection-detail" />
            <Stack.Screen name="explore" />
          </Stack.Protected>
        </Stack>
      </OnboardingProvider>
    </ThemeProvider>
  );
}
