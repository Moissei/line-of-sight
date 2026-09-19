import { ProfileStatusProvider, useProfileStatus } from '@/components/profile-status-provider';
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

  const [auth, setAuth] = useState({ ready: false, signedIn: false, generation: 0, userId: null as string | null });
  useEffect(() => {
    let previousUser: string | null = null;
    const unsubscribeDeletion = onAccountDeleted(() => {
      setAuth(current => ({ ready: true, signedIn: false, userId: null, generation: current.generation + 1 }));
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') resetDeletedAccount();
      const nextUser = session?.user.id ?? null;
      const reset = event === 'SIGNED_OUT' || (previousUser !== null && previousUser !== nextUser);
      previousUser = nextUser;
      setAuth((current) => ({ ready: true, signedIn: !!session && !isAccountDeleted(), userId: nextUser, generation: current.generation + (reset ? 1 : 0) }));
      // Do not await Supabase APIs inside an Auth callback.
      if (reset) setTimeout(() => { void supabase.removeAllChannels().catch(() => {}); }, 0);
    });
    return () => { unsubscribeDeletion(); data.subscription.unsubscribe(); };
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
        <ProfileStatusProvider userId={auth.signedIn ? auth.userId : null}>
          <AuthenticatedRoutes signedIn={auth.signedIn} generation={auth.generation} />
        </ProfileStatusProvider>
      </OnboardingProvider>
    </ThemeProvider>
  );
}

function AuthenticatedRoutes({ signedIn, generation }: { signedIn: boolean; generation: number }) {
  const { status } = useProfileStatus();
  const complete = signedIn && status === 'complete';
  usePushNotifications(complete, generation);
  return <Stack screenOptions={{ headerShown: false }}>
    <Stack.Protected guard={!signedIn}>
      <Stack.Screen name="index" /><Stack.Screen name="login" /><Stack.Screen name="sign-up" />
    </Stack.Protected>
    <Stack.Protected guard={signedIn}>
      <Stack.Screen name="profile-gate" />
      <Stack.Screen name="account" />
      <Stack.Protected guard={status === 'required'}>
        <Stack.Screen name="create-profile" /><Stack.Screen name="intentions" />
      </Stack.Protected>
      <Stack.Protected guard={complete}>
        <Stack.Screen name="(tabs)" /><Stack.Screen name="edit-profile" /><Stack.Screen name="connection-detail" /><Stack.Screen name="explore" />
      </Stack.Protected>
    </Stack.Protected>
    <Stack.Screen name="auth-callback" />
  </Stack>;
}
