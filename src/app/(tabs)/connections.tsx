import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loadConnections, type Connection } from '@/lib/connections';

export default function ConnectionsScreen() {
  const router = useRouter();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const loaded = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async (manual = false) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(!loaded.current); setRefreshing(manual);
    try {
      const data = await loadConnections(abort.signal);
      if (!abort.signal.aborted) {
        setConnections(data);
        loaded.current = true; setError(false);
      }
    } catch { if (!abort.signal.aborted) setError(true); }
    finally { if (!abort.signal.aborted) { setLoading(false); setRefreshing(false); } }
  }, []);
  useFocusEffect(useCallback(() => {
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => { clearTimeout(timer); controller.current?.abort(); };
  }, [refresh]));

  return <SafeAreaView edges={['top', 'left', 'right']} style={styles.screen}>
    <StatusBar style="dark" />
    <ScrollView contentContainerStyle={[styles.content, !loading && !error && connections.length === 0 && styles.emptyContent]} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh(true)} tintColor="#253D2F" />}>
      <Text accessibilityRole="header" style={styles.title}>Connections</Text>
      <Text style={styles.secondary}>People you have chosen to connect with.</Text>
      {loading && connections.length === 0 && <Text style={styles.secondary}>Loading connections...</Text>}
      {error && <Text accessibilityRole="alert" style={styles.secondary}>Couldn’t load connections. Please try again.</Text>}
      {!loading && !error && connections.length === 0 && <View style={styles.emptyState}>
        <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.linkedCircles}>
          <View style={styles.leftCircle} /><View style={styles.rightCircle} />
        </View>
        <Text style={styles.emptyTitle}>No connections yet</Text>
        <Text style={styles.emptyDescription}>When you and someone nearby choose to connect, they’ll appear here.</Text>
      </View>}
      {connections.map((connection) => <Pressable key={connection.connection_id}
        accessibilityRole="button" accessibilityLabel={`Open connection with ${connection.first_name}`}
        onPress={() => router.push({ pathname: '/connection-detail', params: { connectionId: connection.connection_id } })}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
        <View style={styles.header}>
          <View style={styles.avatar} accessible={false}><View style={styles.head} /><View style={styles.shoulders} /></View>
          <View style={styles.identity}><Text numberOfLines={2} ellipsizeMode="tail" style={styles.name}>{connection.first_name}{connection.age !== null ? `, ${connection.age}` : ''}</Text>
            {!!connection.bio && <Text numberOfLines={2} ellipsizeMode="tail" style={styles.cardSecondary}>{connection.bio}</Text>}
            {!!connection.gender && <Text numberOfLines={1} ellipsizeMode="tail" style={styles.cardSecondary}>{connection.gender}</Text>}
            {connection.intents.length > 0 && <View style={styles.intents}>{connection.intents.map((intent, index) => <Text key={index} style={styles.chip}>{intent}</Text>)}</View>}
            <View style={styles.messageAction}>
              <SymbolView name={{ ios: 'envelope', android: 'mail_outline', web: 'mail_outline' }} size={16} tintColor="#B59962" accessible={false} />
              <Text style={styles.messageLabel}>Message</Text>
            </View>
          </View>
        </View>
      </Pressable>)}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FEFCF8' }, content: { width: '100%', maxWidth: 460, alignSelf: 'center', padding: 28, gap: 14 },
  title: { fontSize: 30, fontWeight: '600', color: '#202D25' }, secondary: { fontSize: 15, lineHeight: 22, color: '#656D66' },
  emptyContent: { flexGrow: 1 },
  emptyState: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 40, paddingBottom: 80 },
  linkedCircles: { width: 100, height: 58, marginBottom: 24 },
  leftCircle: { position: 'absolute', left: 0, width: 58, height: 58, borderRadius: 29, borderWidth: 1, borderColor: '#253D2F' },
  rightCircle: { position: 'absolute', right: 0, width: 58, height: 58, borderRadius: 29, borderWidth: 1, borderColor: '#B59962' },
  emptyTitle: { fontSize: 21, lineHeight: 28, fontWeight: '600', color: '#202D25', textAlign: 'center', marginBottom: 10 },
  emptyDescription: { maxWidth: 280, fontSize: 15, lineHeight: 23, color: '#656D66', textAlign: 'center' },
  card: { backgroundColor: '#FEFCF8', borderWidth: 1, borderColor: '#253D2F', borderRadius: 18, padding: 16 }, header: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' }, identity: { flex: 1, minWidth: 0, minHeight: 114, gap: 4 },
  name: { fontSize: 21, lineHeight: 27, fontWeight: '600', color: '#202D25' }, avatar: { width: 90, height: 114, flexShrink: 0, borderRadius: 12, overflow: 'hidden', backgroundColor: '#EBEEE7', alignItems: 'center', justifyContent: 'center', gap: 4 },
  head: { width: 17, height: 17, borderRadius: 9, backgroundColor: '#8B988D' }, shoulders: { width: 34, height: 18, borderRadius: 9, backgroundColor: '#8B988D' },
  cardSecondary: { fontSize: 14, lineHeight: 20, color: '#656D66' },
  intents: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 6 }, chip: { maxWidth: '100%', backgroundColor: '#253D2F', color: '#FEFCF8', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 10, fontSize: 12, lineHeight: 17 },
  messageAction: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  messageLabel: { fontSize: 14, fontWeight: '600', color: '#253D2F' },
  pressed: { opacity: 0.75 },
});
