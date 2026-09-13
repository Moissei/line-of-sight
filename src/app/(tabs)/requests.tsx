import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loadIncomingRequests, respondToRequest, type IncomingRequest, type RequestResponse } from '@/lib/incoming-requests';

export default function IncomingRequestsScreen() {
  const [requests, setRequests] = useState<IncomingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const inFlight = useRef(false);
  const focused = useRef(false);
  const generation = useRef(0);
  const refreshVersion = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    const current = generation.current;
    const version = ++refreshVersion.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    try {
      const data = await loadIncomingRequests(abort.signal);
      if (current === generation.current && version === refreshVersion.current) {
        setRequests(data); setError('');
      }
    } catch {
      if (!abort.signal.aborted && current === generation.current && version === refreshVersion.current)
        setError('Could not load requests. Please try refreshing.');
    } finally {
      if (current === generation.current && version === refreshVersion.current) setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    const timer = setTimeout(() => {
      setRequests([]); setNotice(''); setError(''); setLoading(true);
      if (!inFlight.current) setBusyId(null);
      void refresh();
    }, 0);
    return () => { focused.current = false; clearTimeout(timer); generation.current++; refreshVersion.current++; controller.current?.abort(); };
  }, [refresh]));

  async function respond(requestId: string, response: RequestResponse) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusyId(requestId); setError(''); setNotice('');
    const current = generation.current;
    refreshVersion.current++;
    controller.current?.abort();
    try {
      await respondToRequest(requestId, response);
      if (current === generation.current) {
        setRequests((previous) => previous.filter((request) => request.request_id !== requestId));
        setNotice(response === 'accepted' ? 'Connection accepted.' : 'Request removed.');
      }
    } catch {
      if (current === generation.current) setError('Couldn\u2019t update request. Please try again.');
    } finally {
      inFlight.current = false;
      if (focused.current) {
        setBusyId(null); setLoading(false);
        if (current !== generation.current) void refresh();
      }
    }
  }

  return <SafeAreaView edges={['top', 'left', 'right']} style={styles.screen}>
    <StatusBar style="dark" />
    <ScrollView contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>Requests</Text>
      <Text style={styles.secondary}>People who would like to connect with you.</Text>
      <Pressable accessibilityRole="button" style={styles.link} disabled={busyId !== null}
        onPress={() => { setLoading(true); void refresh(); }}><Text style={styles.linkText}>Refresh requests</Text></Pressable>
      {loading && <Text style={styles.secondary}>Loading requests...</Text>}
      {!!error && <Text accessibilityRole="alert" style={styles.secondary}>{error}</Text>}
      {!!notice && <Text accessibilityLiveRegion="polite" style={styles.secondary}>{notice}</Text>}
      {!loading && !error && requests.length === 0 && <Text style={styles.secondary}>No connection requests right now.</Text>}
      {requests.map((request) => <View key={request.request_id} style={styles.card}>
        <View style={styles.header}>
          <View style={styles.avatar} accessible={false}><View style={styles.head} /><View style={styles.shoulders} /></View>
          <View style={styles.identity}><Text style={styles.name}>{request.first_name}{request.age !== null ? `, ${request.age}` : ''}</Text>
            {!!request.gender && <Text style={styles.secondary}>{request.gender}</Text>}</View>
        </View>
        {!!request.bio && <Text style={styles.secondary}>{request.bio}</Text>}
        <View style={styles.intents}>{request.intents.map((intent, index) => <Text key={index} style={styles.chip}>{intent}</Text>)}</View>
        <View style={styles.actions}>{(['accepted', 'declined'] as const).map((response) => <Pressable key={response}
          accessibilityRole="button" disabled={busyId !== null} accessibilityState={{ disabled: busyId !== null, busy: busyId === request.request_id }}
          onPress={() => void respond(request.request_id, response)}
          style={[styles.button, response === 'declined' && styles.outline, busyId !== null && styles.disabled]}>
          <Text style={[styles.buttonText, response === 'declined' && styles.linkText]}>{response === 'accepted' ? 'ACCEPT' : 'DECLINE'}</Text>
        </Pressable>)}</View>
        {busyId === request.request_id && <Text style={styles.secondary}>Updating request...</Text>}
      </View>)}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FEFCF8' }, content: { width: '100%', maxWidth: 460, alignSelf: 'center', padding: 28, gap: 14 },
  title: { fontSize: 30, fontWeight: '600', color: '#202D25' }, secondary: { fontSize: 15, lineHeight: 22, color: '#656D66' },
  link: { minHeight: 44, justifyContent: 'center' }, linkText: { color: '#253D2F', fontSize: 14, fontWeight: '600' },
  card: { borderWidth: 1, borderColor: '#C9CEC7', borderRadius: 16, padding: 18, gap: 14 }, header: { flexDirection: 'row', gap: 12, alignItems: 'center' }, identity: { flex: 1 },
  name: { fontSize: 22, fontWeight: '600', color: '#202D25' }, avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#EBEEE7', alignItems: 'center', justifyContent: 'center', gap: 3 },
  head: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#8B988D' }, shoulders: { width: 24, height: 13, borderRadius: 6, backgroundColor: '#8B988D' },
  intents: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, chip: { backgroundColor: '#EBEEE7', color: '#253D2F', padding: 6, borderRadius: 10, fontSize: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, button: { flex: 1, minWidth: 90, minHeight: 48, padding: 12, borderRadius: 12, backgroundColor: '#253D2F', justifyContent: 'center', alignItems: 'center' },
  outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#C9CEC7' }, buttonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' }, disabled: { opacity: 0.6 },
});
