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
        setError('Could not load requests. Please try again.');
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
    <ScrollView contentContainerStyle={[styles.content, !loading && !error && requests.length === 0 && styles.emptyContent]}>
      <Text accessibilityRole="header" style={styles.title}>Requests</Text>
      <Text style={styles.secondary}>People who want to connect with you.</Text>
      {loading && <Text style={styles.secondary}>Loading requests...</Text>}
      {!!error && <Text accessibilityRole="alert" style={styles.secondary}>{error}</Text>}
      {!!notice && <Text accessibilityLiveRegion="polite" style={styles.secondary}>{notice}</Text>}
      {!loading && !error && requests.length === 0 && <View style={styles.emptyState}>
        <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.connectionMotif}>
          <View style={styles.personOutline}><View style={styles.outlineHead} /><View style={styles.outlineShoulders} /></View>
          <View style={styles.connectionLine} />
          <View style={styles.personOutline}><View style={styles.outlineHead} /><View style={styles.outlineShoulders} /></View>
        </View>
        <Text style={styles.emptyTitle}>No requests yet</Text>
        <Text style={styles.emptyDescription}>When someone nearby wants to connect, their request will appear here.</Text>
      </View>}
      {requests.map((request) => <View key={request.request_id} style={styles.card}>
        <View style={styles.header}>
          <View style={styles.avatar} accessible={false}><View style={styles.head} /><View style={styles.shoulders} /></View>
          <View style={styles.identity}><Text numberOfLines={2} ellipsizeMode="tail" style={styles.name}>{request.first_name}{request.age !== null ? `, ${request.age}` : ''}</Text>
            {!!request.bio && <Text numberOfLines={2} ellipsizeMode="tail" style={styles.cardSecondary}>{request.bio}</Text>}
            {!!request.gender && <Text numberOfLines={1} ellipsizeMode="tail" style={styles.cardSecondary}>{request.gender}</Text>}
            {request.intents.length > 0 && <View style={styles.intents}>{request.intents.map((intent, index) => <Text key={index} style={styles.chip}>{intent}</Text>)}</View>}
          </View>
        </View>
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
  emptyContent: { flexGrow: 1 },
  emptyState: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 40, paddingBottom: 80 },
  connectionMotif: { width: 112, height: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  personOutline: { width: 30, alignItems: 'center', gap: 6 },
  outlineHead: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: '#253D2F' },
  outlineShoulders: { width: 28, height: 17, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderWidth: 1, borderBottomWidth: 0, borderColor: '#253D2F' },
  connectionLine: { width: 28, height: 1, backgroundColor: '#B59962' },
  emptyTitle: { fontSize: 21, lineHeight: 28, fontWeight: '600', color: '#202D25', textAlign: 'center', marginBottom: 10 },
  emptyDescription: { maxWidth: 280, fontSize: 15, lineHeight: 23, color: '#656D66', textAlign: 'center' },
  linkText: { color: '#253D2F', fontSize: 14, fontWeight: '600' },
  card: { backgroundColor: '#FEFCF8', borderWidth: 1, borderColor: '#253D2F', borderRadius: 18, padding: 16, gap: 12 }, header: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' }, identity: { flex: 1, minWidth: 0, gap: 4 },
  name: { fontSize: 21, lineHeight: 27, fontWeight: '600', color: '#202D25' }, avatar: { width: 90, height: 114, flexShrink: 0, borderRadius: 12, overflow: 'hidden', backgroundColor: '#EBEEE7', alignItems: 'center', justifyContent: 'center', gap: 4 },
  head: { width: 17, height: 17, borderRadius: 9, backgroundColor: '#8B988D' }, shoulders: { width: 34, height: 18, borderRadius: 9, backgroundColor: '#8B988D' },
  cardSecondary: { fontSize: 14, lineHeight: 20, color: '#656D66' },
  intents: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 6 }, chip: { maxWidth: '100%', backgroundColor: '#253D2F', color: '#FEFCF8', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 10, fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, button: { flex: 1, minWidth: 90, minHeight: 48, padding: 12, borderRadius: 12, backgroundColor: '#253D2F', justifyContent: 'center', alignItems: 'center' },
  outline: { backgroundColor: 'transparent' }, buttonText: { color: '#FEFCF8', fontSize: 13, fontWeight: '700' }, disabled: { opacity: 0.6 },
});
