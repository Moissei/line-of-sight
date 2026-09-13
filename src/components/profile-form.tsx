import { useRouter } from 'expo-router';
import { BottomTabBarHeightContext } from 'expo-router/js-tabs';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { useContext, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOnboarding } from '@/components/onboarding-provider';
import { validateProfile, saveProfile, profileSaveError, PROFILE_INTENTS } from '@/lib/profile';
import { ProfilePhotoSlots } from '@/components/profile-photo-slots';

export function ProfileForm({ editing = false, tabScreen = false }: { editing?: boolean; tabScreen?: boolean }) {
  const router = useRouter();
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const { draft, setDraft } = useOnboarding();
  const { firstName, dateOfBirth, gender, bio } = draft;
  const setFirstName = (value: string) => setDraft((previous) => ({ ...previous, firstName: value }));
  const setDateOfBirth = (value: string) => setDraft((previous) => ({ ...previous, dateOfBirth: value }));
  const setGender = (value: string) => setDraft((previous) => ({ ...previous, gender: value }));
  const setBio = (value: string) => setDraft((previous) => ({ ...previous, bio: value }));
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(true);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  async function submit() {
    if (picking || inFlight.current) return;
    Keyboard.dismiss();
    const validation = validateProfile(draft, false);
    setError(validation ?? '');
    if (validation) return;
    if (!editing) { router.push('/intentions'); return; }
    inFlight.current = true;
    setSaving(true);
    try {
      await saveProfile(draft, true);
      if (tabScreen) router.navigate('/discovery');
      else if (router.canGoBack()) router.back(); else router.replace('/discovery');
    } catch (failure) { setError(profileSaveError(failure)); }
    finally { inFlight.current = false; setSaving(false); }
  }
  return (
    <SafeAreaView edges={tabScreen ? ['top', 'left', 'right'] : ['top', 'bottom', 'left', 'right']} style={styles.screen}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, tabScreen && { paddingBottom: tabBarHeight + 24 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          {!tabScreen && <Pressable
            accessibilityRole="button"
            accessibilityLabel={editing ? "Back to discovery" : "Back to welcome"}
            disabled={saving}
            onPress={() => router.canGoBack() ? router.back() : router.replace(editing ? '/discovery' : '/')}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
            <Text style={styles.backLabel}>Back</Text>
          </Pressable>}

          <View style={styles.heading}>
            <View style={styles.headerRow}>
              <Text accessibilityRole="header" style={[styles.title, { flex: 1 }]}>{editing ? 'Edit profile' : 'Create your profile'}</Text>
              {tabScreen && <Pressable accessibilityRole="button" accessibilityLabel="Account settings"
                disabled={saving} onPress={() => router.push('/account')}
                style={({ pressed }) => [styles.settings, pressed && styles.pressed]}>
                <SymbolView name={{ ios: 'gearshape', android: 'settings', web: 'settings' }} size={22} weight="regular" tintColor="#253D2F" />
              </Pressable>}
            </View>
            <Text style={styles.subtitle}>{editing ? 'Keep your profile up to date.' : 'A little about you. A chance to connect.'}</Text>
          </View>

          <View style={styles.form} pointerEvents={saving ? "none" : "auto"}>
            <View style={styles.field}>
              <Text style={styles.label}>First name</Text>
              <TextInput
                accessibilityLabel="First name"
                autoComplete="given-name"
                autoCapitalize="words"
                placeholder="Your first name"
                placeholderTextColor="#7A817A"
                value={firstName}
                onChangeText={setFirstName}
                maxLength={60}
                style={styles.input}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Date of birth</Text>
              <TextInput
                accessibilityLabel="Date of birth, month slash day slash year"
                placeholder="MM/DD/YYYY"
                placeholderTextColor="#7A817A"
                keyboardType="number-pad"
                value={dateOfBirth}
                onChangeText={(value) => {
                  const digits = value.replace(/\D/g, '').slice(0, 8);
                  setDateOfBirth(digits.replace(/^(\d{2})(\d)/, '$1/$2').replace(/^(\d{2}\/\d{2})(\d)/, '$1/$2'));
                }}
                maxLength={10}
                style={styles.input}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Gender</Text>
              {editing ? <View style={styles.field}>
                <View style={styles.genderOptions}>
                  {(['Male', 'Female'] as const).map((option) => <Pressable key={option}
                    accessibilityRole="radio" accessibilityLabel={option}
                    accessibilityState={{ checked: gender === option, disabled: saving }} disabled={saving}
                    onPress={() => setGender(option)}
                    style={styles.genderOption}>
                    <Text accessible={false} style={[styles.genderSymbol, {
                      color: option === 'Male' ? (gender === option ? '#526F88' : '#8296A7') : (gender === option ? '#956575' : '#B397A1'),
                    }]}>{option === 'Male' ? '\u2642' : '\u2640'}</Text>
                    <Text style={[styles.genderLabel, gender === option && { fontWeight: '600' }]}>{option}</Text>
                    <View accessible={false} style={[styles.genderIndicator, {
                      backgroundColor: gender === option ? (option === 'Male' ? '#526F88' : '#956575') : 'transparent',
                    }]} />
                  </Pressable>)}
                </View>
                {!!gender && gender !== 'Male' && gender !== 'Female' &&
                  <Text style={styles.hint}>Your saved value is unchanged until you select an option.</Text>}
              </View> : <TextInput
                accessibilityLabel="Gender"
                placeholder="How you describe yourself"
                placeholderTextColor="#7A817A"
                autoCapitalize="sentences"
                value={gender}
                onChangeText={setGender}
                maxLength={60}
                style={styles.input}
              />}
            </View>

            <ProfilePhotoSlots onBusy={setPicking} editing={editing} />

            <View style={styles.field}>
              <Text style={styles.label}>{editing ? 'A little about me' : 'Short bio'}</Text>
              <TextInput
                accessibilityLabel={editing ? 'A little about me' : 'Short bio'}
                placeholder="A little about what makes you, you."
                placeholderTextColor="#7A817A"
                value={bio}
                onChangeText={setBio}
                maxLength={200}
                multiline
                textAlignVertical="top"
                style={[styles.input, styles.bio]}
              />
              <Text style={[styles.hint, styles.counter]}>{bio.length}/200</Text>
            </View>
            {editing && <View style={styles.field}>
              <Text style={styles.label}>What brings you here?</Text>
              {PROFILE_INTENTS.map((intent) => <Pressable key={intent} accessibilityRole="checkbox"
                accessibilityState={{ checked: draft.intents.includes(intent) }}
                onPress={() => setDraft((previous) => ({ ...previous, intents: previous.intents.includes(intent)
                  ? previous.intents.filter((item) => item !== intent) : [...previous.intents, intent] }))}
                style={[styles.intentOption, draft.intents.includes(intent) && styles.intentSelected]}>
                <Text style={styles.intentLabel}>{intent}</Text>
                {draft.intents.includes(intent) && <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={16} tintColor="#253D2F" />}
              </Pressable>)}
            </View>}
          </View>

          <View style={styles.footer}>
            {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.subtitle}>{error}</Text>}
            <Pressable
              accessibilityRole="button"
              disabled={picking || saving}
              accessibilityState={{ disabled: picking || saving, busy: saving }}
              onPress={() => void submit()}
              style={({ pressed }) => [styles.continueButton, pressed && styles.pressed]}>
              <Text style={styles.continueLabel}>{editing ? (saving ? 'SAVING...' : 'SAVE CHANGES') : 'CONTINUE'}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FEFCF8' },
  scroll: { flex: 1, minHeight: 0 },
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
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  settings: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 30, fontWeight: '600', letterSpacing: -0.8, color: '#202D25' },
  subtitle: { fontSize: 15, lineHeight: 22, color: '#656D66' },
  form: { gap: 18 },
  field: { gap: 8 },
  genderOptions: { flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'flex-start', gap: 24 },
  genderOption: { minWidth: 64, minHeight: 80, paddingVertical: 6, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', gap: 4 },
  genderSymbol: { fontSize: 43, lineHeight: 49, fontWeight: '400', textAlign: 'center', includeFontPadding: false },
  genderLabel: { fontSize: 14, fontWeight: '400', color: '#202D25' },
  genderIndicator: { width: 20, height: 2 },
  intentOption: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: '#C9CEC7', backgroundColor: '#FEFCF8', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  intentSelected: { backgroundColor: '#E8EEE5', borderColor: '#253D2F' },
  intentLabel: { fontSize: 14, fontWeight: '600', color: '#253D2F' },
  label: { fontSize: 14, fontWeight: '600', color: '#202D25' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#C9CEC7',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#202D25',
  },
  hint: { fontSize: 12, lineHeight: 18, color: '#656D66' },
  bio: { minHeight: 88 },
  counter: { textAlign: 'right' },
  footer: { marginTop: 'auto', paddingTop: 24, gap: 12 },
  continueButton: {
    minHeight: 58,
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderRadius: 16,
    backgroundColor: '#253D2F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueLabel: { fontSize: 14, fontWeight: '700', letterSpacing: 1.5, color: '#FFFFFF' },
  pressed: { opacity: 0.7 },
});
