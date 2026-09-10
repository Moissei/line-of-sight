import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OnboardingProvider, useOnboarding } from '@/components/onboarding-provider';
import { ProfileForm } from '@/components/profile-form';
import { PROFILE_INTENTS } from '@/lib/profile';

// Separate in-memory draft: editing never overwrites an onboarding draft.
export default function EditProfileScreen() {
  return <OnboardingProvider><EditProfileContent /></OnboardingProvider>;
}
function EditProfileContent() {
  const router = useRouter();
  const { draft, setDraft } = useOnboarding();
  const [loadedOwner, setLoadedOwner] = useState<string>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { supabase } = await import('@/lib/supabase');
        const { data: auth, error: authError } = await supabase.auth.getUser();
        if (authError || !auth.user) throw new Error('Account unavailable');
        const { data, error: readError } = await supabase.from('profiles')
          .select('first_name,date_of_birth,gender,bio,intents').eq('user_id', auth.user.id).single();
        if (readError || !data) throw new Error('Profile unavailable');
        const { data: current, error: currentError } = await supabase.auth.getUser();
        if (cancelled) return;
        if (currentError || current.user?.id !== auth.user.id) throw new Error('Account changed');
        const parts = data.date_of_birth?.split('-');
        setDraft({ firstName: data.first_name, dateOfBirth: parts ? `${parts[1]}/${parts[2]}/${parts[0]}` : '',
          gender: data.gender ?? '', bio: data.bio ?? '',
          intents: PROFILE_INTENTS.filter((intent) => data.intents?.includes(intent)),
          photoOwner: auth.user.id, photos: {} });
        setLoadedOwner(auth.user.id);
        setError(false);
      } catch { if (!cancelled) setError(true); }
    }
    void load();
    return () => { cancelled = true; };
  }, [attempt, setDraft]);
  if (loadedOwner && draft.photoOwner === loadedOwner) return <ProfileForm editing />;
  return <SafeAreaView style={styles.screen}><View style={styles.content}>
    <Text style={styles.title}>Edit profile</Text>
    <Text accessibilityRole={error ? 'alert' : undefined} style={styles.text}>
      {error ? 'We could not load your profile. Please check your connection and try again.' : 'Loading your profile...'}
    </Text>
    {error && <Pressable accessibilityRole="button" style={styles.button} onPress={() => { setError(false); setAttempt((value) => value + 1); }}>
      <Text style={styles.text}>Try again</Text>
    </Pressable>}
    <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.canGoBack() ? router.back() : router.replace('/discovery')}>
      <Text style={styles.text}>Back to Discovery</Text>
    </Pressable>
  </View></SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FEFCF8' },
  content: { width: '100%', maxWidth: 460, alignSelf: 'center', padding: 28, gap: 16 },
  title: { fontSize: 30, fontWeight: '600', color: '#202D25' },
  text: { fontSize: 15, lineHeight: 22, color: '#253D2F' },
  button: { minHeight: 44, justifyContent: 'center' },
});
