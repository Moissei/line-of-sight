import { useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { logOut, LOGOUT_ERROR } from '@/lib/logout';
import { runSafetyAction } from '@/lib/safety-actions';

export default function AccountScreen() {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const lock = useRef(false);
  async function submit() {
    await runSafetyAction(lock, async () => {
      setBusy(true); setError(false);
      try { await logOut(); } catch { setError(true); setBusy(false); }
      // Auth state changes reset navigation; no stale callback navigates here.
    });
  }
  return <SafeAreaView style={styles.screen}>
    <View style={styles.content}>
      <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.back()}><Text style={styles.link}>Back</Text></Pressable>
      <Text accessibilityRole="header" style={styles.title}>Account</Text>
      <Pressable accessibilityRole="button" style={styles.button} onPress={() => { setError(false); setConfirm(true); }}><Text style={styles.link}>Log Out</Text></Pressable>
    </View>
    <Modal visible={confirm} transparent animationType="fade" onRequestClose={() => { if (!lock.current) setConfirm(false); }}>
      <View style={styles.overlay}><View style={styles.dialog} accessibilityViewIsModal>
        <Text accessibilityRole="header" style={styles.title}>Log out?</Text>
        <Text style={styles.text}>We’ll try to stop your Looking session, then log you out on this device.</Text>
        {error && <Text accessibilityRole="alert" style={styles.text}>{LOGOUT_ERROR}</Text>}
        <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => void submit()}><Text style={styles.link}>{busy ? 'Logging out...' : 'Log Out'}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => setConfirm(false)}><Text style={styles.link}>Cancel</Text></Pressable>
      </View></View>
    </Modal>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FEFCF8' }, content: { width: '100%', maxWidth: 460, alignSelf: 'center', padding: 28, gap: 18 },
  title: { fontSize: 26, fontWeight: '600', color: '#202D25' }, text: { fontSize: 15, lineHeight: 23, color: '#656D66' },
  link: { color: '#253D2F', fontSize: 15, fontWeight: '600' }, button: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 12 },
  overlay: { flex: 1, backgroundColor: 'rgba(20,30,22,0.45)', padding: 24, justifyContent: 'center' },
  dialog: { width: '100%', maxWidth: 420, alignSelf: 'center', borderRadius: 18, padding: 24, gap: 12, backgroundColor: '#FEFCF8' },
});
