import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useRef, useState } from 'react';
import {
  Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, useWindowDimensions, View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { authErrorMessage } from '@/lib/auth-errors';

export function AuthScreen({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const signup = mode === 'signup';
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const loginTopSpace = Math.min(72, Math.max(24, (height - insets.top - insets.bottom) * 0.08));
  const [email, setEmail] = useState('');
  // Passwords exist only in the current form's memory, never in app storage or routes.
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const focused = useRef(false);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => {
      focused.current = false;
      setPassword('');
      setConfirmation('');
    };
  }, []));

  async function submit() {
    if (inFlight.current) return;
    setError('');
    const normalizedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }
    if (signup && !needsConfirmation) {
      if (password.length < 8) {
        setError('Please choose a password with at least 8 characters.');
        return;
      }
      if (password !== confirmation) {
        setError('Your passwords do not match. Please try again.');
        return;
      }
    }
    Keyboard.dismiss();
    inFlight.current = true;
    setBusy(true);
    try {
      const { supabase } = await import('@/lib/supabase');
      if (!focused.current) return;
      const { data, error: authError } = signup && !needsConfirmation
        ? await supabase.auth.signUp({ email: normalizedEmail, password,
          ...(Platform.OS !== 'web' ? { options: { emailRedirectTo: 'lineofsight://auth-callback' } } : {}),
        })
        : await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
      if (!focused.current) return;
      if (authError) {
        setError(authErrorMessage(authError));
        return;
      }
      setPassword('');
      setConfirmation('');
      if (data.session) {
        router.replace(signup ? '/create-profile' : '/discovery');
      } else if (signup) {
        // Supabase can deliberately obscure duplicate accounts. Do not claim an
        // account was created until there is a session; give a safe confirmation path.
        setNeedsConfirmation(true);
      } else {
        setError('We could not log you in. Please try again.');
      }
    } catch (requestError) {
      if (focused.current) setError(authErrorMessage(requestError));
    } finally {
      inFlight.current = false;
      if (focused.current) setBusy(false);
    }
  }

  const buttonLabel = needsConfirmation ? 'CONTINUE' : signup ? 'CREATE ACCOUNT' : 'LOG IN';

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Pressable accessibilityRole="button" accessibilityLabel="Back to welcome" onPress={() => router.replace('/')} style={styles.back}>
            <Text style={styles.link}>Back to welcome</Text>
          </Pressable>
          <View style={[styles.heading, signup ? styles.signupHeading : [styles.loginHeading, { marginTop: loginTopSpace }]]}>
            <Text accessibilityRole="header" style={styles.title}>{signup ? 'Create your account' : 'Welcome back'}</Text>
            <Text style={styles.subtitle}>{signup ? 'Be ready when the moment happens.' : 'Pick up where you left off.'}</Text>
          </View>
          {needsConfirmation && (
            <Text accessibilityLiveRegion="polite" style={styles.notice}>
              Check your inbox for a confirmation email, then return here to continue.
            </Text>
          )}
          <View style={[styles.form, !signup && styles.loginForm]}>
            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <TextInput accessibilityLabel="Email" value={email} onChangeText={setEmail} editable={!busy && !needsConfirmation}
                placeholder="you@example.com" placeholderTextColor="#7A817A" keyboardType="email-address"
                autoComplete="email" autoCapitalize="none" autoCorrect={false} style={styles.input} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <TextInput accessibilityLabel="Password" value={password} onChangeText={setPassword} editable={!busy}
                placeholder="Your password" placeholderTextColor="#7A817A" secureTextEntry autoCapitalize="none"
                autoCorrect={false} spellCheck={false} autoComplete={signup && !needsConfirmation ? 'new-password' : 'current-password'}
                onSubmitEditing={signup && !needsConfirmation ? undefined : () => void submit()} style={styles.input} />
              {signup && !needsConfirmation && <Text style={styles.hint}>Use at least 8 characters. A mix of letters, numbers, and symbols is best.</Text>}
            </View>
            {signup && !needsConfirmation && (
              <View style={styles.field}>
                <Text style={styles.label}>Confirm password</Text>
                <TextInput accessibilityLabel="Confirm password" value={confirmation} onChangeText={setConfirmation} editable={!busy}
                  placeholder="Re-enter your password" placeholderTextColor="#7A817A" secureTextEntry autoCapitalize="none"
                  autoCorrect={false} spellCheck={false} autoComplete="off" importantForAutofill="no"
                  textContentType="none" onSubmitEditing={() => void submit()} style={styles.input} />
              </View>
            )}
            {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
          </View>
          <View style={[styles.footer, signup ? styles.signupFooter : styles.loginFooter]}>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} disabled={busy}
              onPress={() => void submit()} style={({ pressed }) => [styles.button, (pressed || busy) && styles.pressed]}>
              <Text style={styles.buttonLabel}>{busy ? 'PLEASE WAIT...' : buttonLabel}</Text>
            </Pressable>
            {signup && <Pressable accessibilityRole="button" onPress={() => router.replace('/login')} style={styles.secondary}>
              <Text style={styles.link}>Already have an account? Log in</Text>
            </Pressable>}
            {!signup && <Pressable accessibilityRole="button" onPress={() => router.replace('/sign-up')} style={styles.secondary}>
              <Text style={styles.link}>New to Line of Sight? Create account</Text>
            </Pressable>}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FEFCF8' },
  content: { flexGrow: 1, width: '100%', maxWidth: 460, alignSelf: 'center', paddingHorizontal: 28, paddingTop: 8, paddingBottom: 24 },
  back: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' },
  link: { fontSize: 14, color: '#253D2F', fontWeight: '600', textAlign: 'center' },
  heading: { gap: 8, marginTop: 24, marginBottom: 28 },
  signupHeading: { marginTop: 20, marginBottom: 24 },
  loginHeading: { gap: 12, marginBottom: 32 },
  loginForm: { gap: 28 },
  title: { fontSize: 30, fontWeight: '600', letterSpacing: -0.8, color: '#202D25' },
  subtitle: { fontSize: 15, lineHeight: 22, color: '#656D66' },
  notice: { fontSize: 15, lineHeight: 22, color: '#253D2F', marginBottom: 16 },
  form: { gap: 20 },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '600', color: '#202D25' },
  input: { minHeight: 50, borderWidth: 1, borderColor: '#C9CEC7', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: '#202D25' },
  hint: { fontSize: 12, lineHeight: 18, color: '#656D66' },
  error: { fontSize: 14, lineHeight: 22, color: '#9B3434' },
  footer: { marginTop: 'auto', paddingTop: 32, gap: 12 },
  signupFooter: { marginTop: 0, paddingTop: 24, gap: 16 },
  loginFooter: { marginTop: 0, paddingTop: 32, gap: 16 },
  button: { minHeight: 58, paddingHorizontal: 24, paddingVertical: 18, borderRadius: 16, backgroundColor: '#253D2F', alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { fontSize: 14, fontWeight: '700', letterSpacing: 1.5, color: '#FFFFFF', textAlign: 'center' },
  secondary: { minHeight: 44, justifyContent: 'center' },
  pressed: { opacity: 0.7 },
});
