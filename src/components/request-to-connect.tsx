import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { hasOutgoingRequest, sendConnectionRequest } from '@/lib/connection-requests';

export function RequestToConnect({ targetUserId, revision = 0 }: { targetUserId: string; revision?: number }) {
  const [status, setStatus] = useState<'checking' | 'ready' | 'sending' | 'sent'>('checking');
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const sendVersion = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (inFlight.current) return;
    const version = sendVersion.current;
    let cancelled = false;
    void hasOutgoingRequest(targetUserId).then((sent) => {
      if (!cancelled && !inFlight.current && version === sendVersion.current) setStatus(sent ? 'sent' : 'ready');
    }).catch(() => {
      // The send RPC remains authoritative and idempotent if this read fails.
      if (!cancelled && !inFlight.current && version === sendVersion.current) { setStatus((previous) => previous === 'checking' ? 'ready' : previous); setError('Could not check request status. You can try sending again.'); }
    });
    return () => { cancelled = true; };
  }, [targetUserId, revision]);

  async function send() {
    if (inFlight.current || status !== 'ready') return;
    sendVersion.current += 1;
    inFlight.current = true; // Synchronous guard catches taps before rerender.
    setStatus('sending');
    setError('');
    try {
      await sendConnectionRequest(targetUserId);
      if (mounted.current) setStatus('sent');
    } catch {
      if (mounted.current) { setStatus('ready'); setError('Couldn’t send request. Please try again.'); }
    } finally { inFlight.current = false; }
  }
  return <View style={styles.container}>
    <Pressable accessibilityRole="button" disabled={status !== 'ready'}
      accessibilityState={{ disabled: status !== 'ready', busy: status === 'checking' || status === 'sending' }}
      accessibilityHint={status === 'checking' ? 'Checking for an existing request' : undefined}
      onPress={() => void send()} style={({ pressed }) => [styles.button, (pressed || status !== 'ready') && styles.muted]}>
      <Text style={styles.label}>{status === 'sent' ? 'REQUEST SENT' : status === 'sending' ? 'SENDING...' : 'REQUEST TO CONNECT'}</Text>
    </Pressable>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  container: { gap: 8 },
  button: { minHeight: 48, borderRadius: 12, padding: 14, backgroundColor: '#253D2F', alignItems: 'center', justifyContent: 'center' },
  label: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', letterSpacing: 1, textAlign: 'center' },
  muted: { opacity: 0.6 }, error: { fontSize: 13, lineHeight: 19, color: '#656D66' },
});
