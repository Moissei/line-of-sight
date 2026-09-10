import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
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
import { validateProfile } from '@/lib/profile';

export default function CreateProfileScreen() {
  const router = useRouter();
  const { draft, setDraft } = useOnboarding();
  const { firstName, dateOfBirth, gender, bio } = draft;
  const setFirstName = (value: string) => setDraft((previous) => ({ ...previous, firstName: value }));
  const setDateOfBirth = (value: string) => setDraft((previous) => ({ ...previous, dateOfBirth: value }));
  const setGender = (value: string) => setDraft((previous) => ({ ...previous, gender: value }));
  const setBio = (value: string) => setDraft((previous) => ({ ...previous, bio: value }));
  const [error, setError] = useState('');

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to welcome"
            onPress={() => router.canGoBack() ? router.back() : router.replace('/')}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
            <Text style={styles.backLabel}>Back</Text>
          </Pressable>

          <View style={styles.heading}>
            <Text accessibilityRole="header" style={styles.title}>Create your profile</Text>
            <Text style={styles.subtitle}>A little about you. A chance to connect.</Text>
          </View>

          <View style={styles.form}>
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
              <TextInput
                accessibilityLabel="Gender"
                placeholder="How you describe yourself"
                placeholderTextColor="#7A817A"
                autoCapitalize="sentences"
                value={gender}
                onChangeText={setGender}
                maxLength={60}
                style={styles.input}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Photos</Text>
              <View style={styles.photos} accessible accessibilityLabel="Photo placeholders. Adding photos will be available later.">
                {[1, 2, 3].map((slot) => (
                  <View key={slot} style={styles.photoPlaceholder}>
                    <Text style={styles.photoSymbol}>+</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.hint}>You can add photos later.</Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Short bio</Text>
              <TextInput
                accessibilityLabel="Short bio"
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
          </View>

          <View style={styles.footer}>
            {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.subtitle}>{error}</Text>}
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                Keyboard.dismiss();
                const validation = validateProfile(draft, false);
                setError(validation ?? '');
                if (validation) return;
                router.push('/intentions');
              }}
              style={({ pressed }) => [styles.continueButton, pressed && styles.pressed]}>
              <Text style={styles.continueLabel}>CONTINUE</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
  form: { gap: 18 },
  field: { gap: 8 },
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
  photos: { flexDirection: 'row', gap: 12 },
  photoPlaceholder: {
    flex: 1,
    aspectRatio: 1,
    maxHeight: 100,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#C9CEC7',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoSymbol: { fontSize: 28, fontWeight: '300', color: '#656D66' },
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
