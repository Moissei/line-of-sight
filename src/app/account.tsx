import { useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { logOut, LOGOUT_ERROR } from '@/lib/logout';
import { runSafetyAction } from '@/lib/safety-actions';
import { deleteAccount, DELETE_ACCOUNT_ERROR } from '@/lib/delete-account';

export default function AccountScreen() {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const lock = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  async function submitDelete() {
    await runSafetyAction(lock, async () => {
      setDeleting(true); setDeleteError(false);
      try { await deleteAccount(); }
      catch { setDeleteError(true); setDeleting(false); }
    });
  }
  async function submit() {
    await runSafetyAction(lock, async () => {
      setBusy(true); setError(false);
      try { await logOut(); } catch { setError(true); setBusy(false); }
      // Auth state changes reset navigation; no stale callback navigates here.
    });
  }
  return <SafeAreaView style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content}>
      <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.back()}><Text style={styles.link}>Back</Text></Pressable>
      <Text accessibilityRole="header" style={styles.title}>Account</Text>
      <Pressable accessibilityRole="button" style={styles.button} onPress={() => { setError(false); setConfirm(true); }}><Text style={styles.link}>Log Out</Text></Pressable>
      <View style={styles.dangerSection}>
        <Text accessibilityRole="header" style={styles.danger}>Delete Account</Text>
        <Text style={styles.text}>Permanently delete your account, profile and photos, and stop discovery. This cannot be undone. People you connected with may keep conversation history showing you as Deleted User.</Text>
        <Pressable accessibilityRole="button" disabled={deleting || busy} style={styles.button} onPress={() => { setDeleteError(false); setConfirmDelete(true); }}><Text style={styles.danger}>Delete Account</Text></Pressable>
      </View>
    </ScrollView>
    <Modal visible={confirm} transparent animationType="fade" onRequestClose={() => { if (!lock.current) setConfirm(false); }}>
      <View style={styles.overlay}><View style={styles.dialog} accessibilityViewIsModal>
        <Text accessibilityRole="header" style={styles.title}>Log out?</Text>
        <Text style={styles.text}>We’ll try to stop your Looking session, then log you out on this device.</Text>
        {error && <Text accessibilityRole="alert" style={styles.text}>{LOGOUT_ERROR}</Text>}
        <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => void submit()}><Text style={styles.link}>{busy ? 'Logging out...' : 'Log Out'}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => setConfirm(false)}><Text style={styles.link}>Cancel</Text></Pressable>
      </View></View>
    </Modal>
    <Modal visible={confirmDelete} transparent animationType="fade" onRequestClose={() => { if (!lock.current) setConfirmDelete(false); }}>
      <View style={styles.overlay}><View style={styles.dialog} accessibilityViewIsModal>
        <Text accessibilityRole="header" style={styles.title}>Permanently delete account?</Text>
        <Text style={styles.text}>Your account, profile and photos will be permanently removed and discovery will stop. This cannot be undone. Past conversations may remain for others as Deleted User.</Text>
        {deleteError && <Text accessibilityRole="alert" style={styles.text}>{DELETE_ACCOUNT_ERROR}</Text>}
        <Pressable accessibilityRole="button" disabled={deleting} style={styles.button} onPress={() => void submitDelete()}><Text style={styles.danger}>{deleting ? 'Deleting account…' : 'Delete permanently'}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={deleting} style={styles.button} onPress={() => setConfirmDelete(false)}><Text style={styles.link}>Cancel</Text></Pressable>
      </View></View>
    </Modal>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  dangerSection: { marginTop: 32, borderTopWidth: 1, borderTopColor: '#DDD6CC', paddingTop: 24, gap: 14 },
  danger: { color: '#923C32', fontSize: 16, fontWeight: '600' },
  screen: { flex: 1, backgroundColor: '#FEFCF8' }, content: { width: '100%', maxWidth: 460, alignSelf: 'center', padding: 28, gap: 18 },
  title: { fontSize: 26, fontWeight: '600', color: '#202D25' }, text: { fontSize: 15, lineHeight: 23, color: '#656D66' },
  link: { color: '#253D2F', fontSize: 15, fontWeight: '600' }, button: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 12 },
  overlay: { flex: 1, backgroundColor: 'rgba(20,30,22,0.45)', padding: 24, justifyContent: 'center' },
  dialog: { width: '100%', maxWidth: 420, alignSelf: 'center', borderRadius: 18, padding: 24, gap: 12, backgroundColor: '#FEFCF8' },
});
