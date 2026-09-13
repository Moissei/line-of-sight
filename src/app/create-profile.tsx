import { useRef, useState } from 'react';
import { useRootNavigationState, useRouter } from 'expo-router';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { ProfileForm } from '@/components/profile-form';
import { logOut, LOGOUT_ERROR } from '@/lib/logout';

export default function CreateProfileScreen() {
  const router = useRouter();
  const navigation = useRootNavigationState();
  const previous = navigation?.routes[(navigation.index ?? 0) - 1]?.name;
  // A gate/public/tab route is not a meaningful way back out of onboarding.
  const canReturn = previous === 'intentions' || previous === 'account';
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const lock = useRef(false);
  async function submitLogout() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(false);
    try { await logOut(); }
    catch { lock.current = false; setBusy(false); setError(true); }
    // SIGNED_OUT resets profile status and navigation through the existing root.
  }
  return <>
    <ProfileForm topAction={<Pressable accessibilityRole="button" disabled={busy}
      accessibilityLabel={canReturn ? 'Back' : 'Log out'} style={styles.back}
      onPress={() => { if (canReturn && router.canGoBack()) router.back(); else { setError(false); setConfirm(true); } }}>
      <Text style={styles.link}>{canReturn ? 'Back' : 'Log out'}</Text>
    </Pressable>} />
    <Modal visible={confirm} transparent animationType="fade" onRequestClose={() => { if (!lock.current) setConfirm(false); }}>
      <View style={styles.overlay}><View style={styles.dialog} accessibilityViewIsModal>
        <Text accessibilityRole="header" style={styles.title}>Log out?</Text>
        <Text style={styles.text}>Logging out will stop Looking and sign you out of this device.</Text>
        {error && <Text accessibilityRole="alert" style={styles.text}>{LOGOUT_ERROR}</Text>}
        <Pressable accessibilityRole="button" disabled={busy} style={styles.action} onPress={() => void submitLogout()}><Text style={styles.link}>{busy ? 'Logging out...' : 'Log Out'}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} style={styles.action} onPress={() => setConfirm(false)}><Text style={styles.link}>Cancel</Text></Pressable>
      </View></View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  back: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingRight: 20 },
  link: { fontSize: 14, color: '#253D2F', fontWeight: '600' },
  overlay: { flex: 1, backgroundColor: 'rgba(20,30,22,0.45)', padding: 24, justifyContent: 'center' },
  dialog: { width: '100%', maxWidth: 420, alignSelf: 'center', borderRadius: 18, padding: 24, gap: 12, backgroundColor: '#FEFCF8' },
  title: { fontSize: 26, fontWeight: '600', color: '#202D25' },
  text: { fontSize: 15, lineHeight: 23, color: '#656D66' },
  action: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 12 },
});
