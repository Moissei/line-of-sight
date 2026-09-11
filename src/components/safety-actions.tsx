import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ACTION_ERROR, BLOCK_TITLE, blockDescription, performSafetyAction, REPORT_REASONS, runSafetyAction, validReport, type SafetyTarget } from '@/lib/safety-actions';

export function SafetyActions({ target, onBlocked }: { target: SafetyTarget; onBlocked: () => void }) {
  const [mode, setMode] = useState<'more' | 'block' | 'report' | 'success' | null>(null);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const lock = useRef(false);
  function close() { if (!lock.current) { setMode(null); setError(false); } }
  async function submit(action: 'block' | 'report') {
    if (action === 'report' && !validReport(reason, details)) return;
    await runSafetyAction(lock, async () => {
      setBusy(true); setError(false);
      try { await performSafetyAction(target, action, reason, details); }
      catch { setError(true); setBusy(false); return; }
      setBusy(false);
      setMode(action === 'block' ? null : 'success');
      if (action === 'block') onBlocked();
    });
  }
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="More safety actions" style={styles.control}
      onPress={() => { setError(false); setMode('more'); }}><Text style={styles.link}>More</Text></Pressable>
    <Modal visible={mode !== null} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.modal} accessibilityViewIsModal>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
            <Text accessibilityRole="header" style={styles.title}>{mode === 'block' ? BLOCK_TITLE : mode === 'report' ? 'Report this person' : mode === 'success' ? 'Report submitted' : 'Safety actions'}</Text>
            {mode === 'more' && <>
              <Pressable accessibilityRole="button" style={styles.control} onPress={() => setMode('block')}><Text style={styles.link}>Block</Text></Pressable>
              <Pressable accessibilityRole="button" style={styles.control} onPress={() => { setReason(''); setDetails(''); setMode('report'); }}><Text style={styles.link}>Report</Text></Pressable>
            </>}
            {mode === 'block' && <Text style={styles.text}>{blockDescription(target.kind)}</Text>}
            {mode === 'success' && <Text style={styles.text}>Thank you for letting us know.</Text>}
            {mode === 'report' && <>
              <Text style={styles.text}>Choose a reason</Text>
              {REPORT_REASONS.map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: reason === value, disabled: busy }} disabled={busy}
                style={[styles.reason, reason === value && styles.selected]} onPress={() => setReason(value)}>
                <Text style={styles.link}>{reason === value ? '● ' : '○ '}{value}</Text>
              </Pressable>)}
              <TextInput accessibilityLabel="Optional report details" placeholder="Optional details" placeholderTextColor="#656D66" multiline value={details} editable={!busy} onChangeText={setDetails} style={styles.input} />
              <Text style={styles.text}>{Array.from(details).length} / 1000</Text>
            </>}
            {error && <Text accessibilityRole="alert" style={styles.error}>{ACTION_ERROR}</Text>}
            {(mode === 'block' || mode === 'report') && <Pressable accessibilityRole="button" disabled={busy || (mode === 'report' && !validReport(reason, details))}
              style={[styles.submit, (busy || (mode === 'report' && !validReport(reason, details))) && styles.disabled]} onPress={() => void submit(mode)}>
              <Text style={styles.white}>{busy ? 'Submitting...' : mode === 'block' ? 'Block' : 'Submit'}</Text>
            </Pressable>}
            <Pressable accessibilityRole="button" disabled={busy} style={styles.control} onPress={close}><Text style={styles.link}>{mode === 'success' ? 'Done' : 'Cancel'}</Text></Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  control: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center' },
  link: { color: '#253D2F', fontSize: 14, fontWeight: '600' },
  overlay: { flex: 1, backgroundColor: 'rgba(20,30,22,0.45)', justifyContent: 'center', padding: 20 },
  modal: { width: '100%', maxWidth: 440, maxHeight: '90%', alignSelf: 'center', borderRadius: 20, backgroundColor: '#FEFCF8' },
  form: { padding: 22, gap: 12 }, title: { fontSize: 23, color: '#202D25', fontWeight: '600' },
  text: { color: '#656D66', fontSize: 14, lineHeight: 21 }, reason: { minHeight: 44, borderWidth: 1, borderColor: '#C9CEC7', borderRadius: 10, padding: 12 },
  selected: { backgroundColor: '#EBEEE7', borderColor: '#253D2F' }, input: { minHeight: 90, borderWidth: 1, borderColor: '#C9CEC7', borderRadius: 10, padding: 12, textAlignVertical: 'top', color: '#202D25' },
  submit: { minHeight: 46, backgroundColor: '#253D2F', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 }, white: { color: '#FFFFFF', fontWeight: '600' }, error: { color: '#7A3E36', fontSize: 14 },
});
