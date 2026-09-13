import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  // Inspect error presence only. Never render callback values or consume tokens.
  // Supabase may place implicit-flow errors in the URL fragment.
  const fragment = typeof params['#'] === 'string' ? params['#'] : '';
  const fragmentParams = new URLSearchParams(fragment.replace(/^#/, ''));
  const failed = ['error', 'error_code', 'error_description'].some(key =>
    Object.prototype.hasOwnProperty.call(params, key) || fragmentParams.has(key));
  return <SafeAreaView style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>{failed ? 'Check your confirmation link' : 'Continue to Log In'}</Text>
      <Text accessibilityRole={failed ? 'alert' : undefined} style={styles.text}>
        {failed
          ? 'We couldn’t complete email confirmation from this link. It may have expired or already been used. Try logging in if you already confirmed your email.'
          : 'You’ve returned from email confirmation. Log in with your email and password to continue.'}
      </Text>
      <Pressable accessibilityRole="button" onPress={() => router.replace('/login')}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
        <Text style={styles.label}>LOG IN</Text>
      </Pressable>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FEFCF8' },
  content: { width: '100%', maxWidth: 460, alignSelf: 'center', paddingHorizontal: 28, paddingVertical: 40, gap: 24 },
  title: { fontSize: 30, fontWeight: '600', color: '#202D25' },
  text: { fontSize: 15, lineHeight: 22, color: '#656D66' },
  button: { minHeight: 58, borderRadius: 16, backgroundColor: '#253D2F', alignItems: 'center', justifyContent: 'center', padding: 18 },
  label: { fontSize: 14, fontWeight: '700', letterSpacing: 1.5, color: '#FFFFFF' },
  pressed: { opacity: 0.7 },
});
