import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loadConnections, type Connection } from '@/lib/connections';

export default function ConnectionsScreen() {
  const router = useRouter();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true); setError(false);
    try {
      const data = await loadConnections(abort.signal);
      if (!abort.signal.aborted) {
        setConnections(data);
      }
    } catch { if (!abort.signal.aborted) setError(true); }
    finally { if (!abort.signal.aborted) setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => {
    const timer = setTimeout(() => { setConnections([]); void refresh(); }, 0);
    return () => { clearTimeout(timer); controller.current?.abort(); setConnections([]); };
  }, [refresh]));

  return <SafeAreaView style={styles.screen}>
    <StatusBar style="dark" />
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} tintColor="#253D2F" />}>
      <Pressable accessibilityRole="button" style={styles.link} onPress={() => router.canGoBack() ? router.back() : router.replace('/discovery')}>
        <Text style={styles.linkText}>Back to Discovery</Text>
      </Pressable>
      <Text accessibilityRole="header" style={styles.title}>Connections</Text>
      <Text style={styles.secondary}>People you have chosen to connect with.</Text>
      <Pressable accessibilityRole="button" disabled={loading} style={styles.link} onPress={() => void refresh()}>
        <Text style={styles.linkText}>Refresh connections</Text>
      </Pressable>
      {loading && <Text style={styles.secondary}>Loading connections...</Text>}
      {error && <Text accessibilityRole="alert" style={styles.secondary}>Couldn’t load connections. Please try again.</Text>}
      {!loading && !error && connections.length === 0 && <Text style={styles.secondary}>No connections yet.</Text>}
      {connections.map((connection) => <View key={connection.connection_id} style={styles.card}>
        <View style={styles.header}>
          <View style={styles.avatar} accessible={false}><View style={styles.head} /><View style={styles.shoulders} /></View>
          <View style={styles.identity}><Text style={styles.name}>{connection.first_name}{connection.age !== null ? `, ${connection.age}` : ''}</Text>
            {!!connection.gender && <Text style={styles.secondary}>{connection.gender}</Text>}</View>
        </View>
        {!!connection.bio && <Text style={styles.secondary}>{connection.bio}</Text>}
        <View style={styles.intents}>{connection.intents.map((intent, index) => <Text key={index} style={styles.chip}>{intent}</Text>)}</View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open connection with ${connection.first_name}`}
          onPress={() => router.push({ pathname: '/connection-detail', params: { connectionId: connection.connection_id } })} style={styles.button}>
          <Text style={styles.buttonText}>OPEN</Text>
        </Pressable>
      </View>)}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FEFCF8' }, content: { width: '100%', maxWidth: 460, alignSelf: 'center', padding: 28, gap: 14 },
  title: { fontSize: 30, fontWeight: '600', color: '#202D25' }, secondary: { fontSize: 15, lineHeight: 22, color: '#656D66' },
  link: { minHeight: 44, justifyContent: 'center' }, linkText: { color: '#253D2F', fontSize: 14, fontWeight: '600' },
  card: { borderWidth: 1, borderColor: '#C9CEC7', borderRadius: 16, padding: 18, gap: 14 }, header: { flexDirection: 'row', gap: 12, alignItems: 'center' }, identity: { flex: 1, minWidth: 0 },
  name: { fontSize: 22, fontWeight: '600', color: '#202D25' }, avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#EBEEE7', alignItems: 'center', justifyContent: 'center', gap: 3 },
  head: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#8B988D' }, shoulders: { width: 24, height: 13, borderRadius: 6, backgroundColor: '#8B988D' },
  intents: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, chip: { backgroundColor: '#EBEEE7', color: '#253D2F', padding: 6, borderRadius: 10, fontSize: 12 },
  button: { minHeight: 48, padding: 12, borderRadius: 12, backgroundColor: '#253D2F', justifyContent: 'center', alignItems: 'center' }, buttonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
});
