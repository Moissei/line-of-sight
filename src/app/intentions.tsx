import { useProfileStatus } from '@/components/profile-status-provider';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOnboarding } from '@/components/onboarding-provider';
import { emptyProfileDraft, PROFILE_INTENTS, profileSaveError, saveProfile, validateProfile } from '@/lib/profile';

const intentions = PROFILE_INTENTS;
type Intention = (typeof intentions)[number];

export default function IntentionsScreen() {
  const router = useRouter();
  const { refresh: refreshProfileStatus } = useProfileStatus();
  // Descriptive profile information only: NEVER use these intentions to filter nearby
  // visibility in either direction. All actively discoverable users within the required
  // proximity must be able to appear to each other regardless of their intentions.
  // The draft stays in memory until FINISH PROFILE saves it to the owner's profile.
  const { draft, setDraft } = useOnboarding();
  const selectedIntentions = draft.intents;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const canFinish = selectedIntentions.length > 0 && !saving;

  async function finishProfile() {
    if (inFlight.current) return;
    const validation = validateProfile(draft);
    setError(validation ?? '');
    if (validation) return;
    inFlight.current = true;
    setSaving(true);
    try {
      await saveProfile(draft);
      if (mounted.current) {
        setDraft(emptyProfileDraft);
        await refreshProfileStatus();
      }
    } catch (failure) {
      if (mounted.current) setError(profileSaveError(failure));
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  function toggleIntention(intention: Intention) {
    if (inFlight.current) return;
    setDraft((previous) => ({ ...previous, intents: previous.intents.includes(intention)
      ? previous.intents.filter((item) => item !== intention)
      : [...previous.intents, intention] }));
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to create your profile"
          disabled={saving}
          onPress={() => router.canGoBack() ? router.back() : router.replace('/create-profile')}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
          <Text style={styles.backLabel}>Back</Text>
        </Pressable>

        <View style={styles.heading}>
          <Text accessibilityRole="header" style={styles.title}>What brings you here?</Text>
          <Text style={styles.subtitle}>Choose one or more. There is more than one way to connect.</Text>
        </View>

        <View style={styles.options}>
          {intentions.map((intention) => {
            const selected = selectedIntentions.includes(intention);
            return (
              <Pressable
                key={intention}
                accessibilityRole="checkbox"
                accessibilityLabel={intention}
                accessibilityState={{ checked: selected }}
                disabled={saving}
                onPress={() => toggleIntention(intention)}
                style={({ pressed }) => [styles.option, selected && styles.selectedOption, pressed && styles.pressed]}>
                <Text style={[styles.optionLabel, selected && styles.selectedLabel]}>{intention}</Text>
                {selected && <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={16} tintColor="#253D2F" />}
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.note}>
          These choices share what you are looking for. They do not limit who you can see nearby or who can see you.
        </Text>

        <View style={styles.footer}>
          {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.subtitle}>{error}</Text>}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canFinish, busy: saving }}
            accessibilityHint={canFinish ? undefined : 'Choose at least one option to continue'}
            disabled={!canFinish}
            onPress={() => void finishProfile()}
            style={({ pressed }) => [styles.finishButton, !canFinish && styles.disabled, pressed && styles.pressed]}>
            <Text style={styles.finishLabel}>FINISH PROFILE</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FEFCF8' },
  scroll: { flex: 1 },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    paddingHorizontal: 28,
    paddingTop: 8,
    paddingBottom: 24,
  },
  back: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingRight: 20 },
  backLabel: { fontSize: 14, color: '#253D2F', fontWeight: '600' },
  heading: { gap: 8, marginTop: 8, marginBottom: 24 },
  title: { fontSize: 30, fontWeight: '600', letterSpacing: -0.8, color: '#202D25' },
  subtitle: { fontSize: 15, lineHeight: 22, color: '#656D66' },
  options: { gap: 12 },
  option: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#C9CEC7',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectedOption: { backgroundColor: '#E8EEE5', borderColor: '#253D2F' },
  optionLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: '#202D25' },
  selectedLabel: { color: '#253D2F' },
  note: { marginTop: 20, fontSize: 14, lineHeight: 22, color: '#656D66' },
  footer: { marginTop: 'auto', paddingTop: 28, gap: 12 },
  finishButton: {
    minHeight: 58,
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderRadius: 16,
    backgroundColor: '#253D2F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishLabel: { fontSize: 14, fontWeight: '700', letterSpacing: 1.5, color: '#FFFFFF' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
});
