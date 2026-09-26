import { SafetyActions } from '@/components/safety-actions';
import { leaveBlockedChat } from '@/lib/safety-actions';
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable,
  RefreshControl, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loadConnections, type Connection } from '@/lib/connections';
import { watchMessageChanges } from '@/lib/message-realtime';
import { supabase } from '@/lib/supabase';
import {
  beginMessageSend, finishMessageSend, getOlderMessageCursor, loadMessages,
  mergeMessages, MESSAGE_MAX_LENGTH, normalizeMessageBody, sendMessage, type Message,
} from '@/lib/messages';

export default function ConnectionDetailScreen() {
  const { connectionId } = useLocalSearchParams<{ connectionId?: string }>();
  const router = useRouter();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const list = useRef<FlatList<Message>>(null);
  const blocked = useRef(false);
  const realtime = useRef<ReturnType<typeof watchMessageChanges> | null>(null);

  const reloadNewest = useCallback(async (signal: AbortSignal) => {
    if (blocked.current || typeof connectionId !== 'string') return;
    const page = await loadMessages(connectionId, null, signal);
    if (!blocked.current && !signal.aborted) {
      setMessages((current) => mergeMessages(current, page.messages));
      // Preserve the older-page cursor/exhaustion state during live refreshes.
    }
  }, [connectionId]);

  useFocusEffect(useCallback(() => {
    if (blocked.current || typeof connectionId !== 'string') return;
    const watcher = watchMessageChanges(supabase, connectionId, reloadNewest);
    realtime.current = watcher;
    return () => {
      realtime.current = null;
      watcher.dispose();
    };
  }, [connectionId, reloadNewest]));

  const refresh = useCallback(async (showLoading = false) => {
    if (blocked.current) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    if (showLoading) setLoading(true); else setRefreshing(true);
    setLoadError(false);
    try {
      const [connections, page] = await Promise.all([
        loadConnections(abort.signal),
        typeof connectionId === 'string' ? loadMessages(connectionId, null, abort.signal)
          : Promise.reject(new Error('Connection unavailable')),
      ]);
      if (!blocked.current && !abort.signal.aborted) {
        setConnection(connections.find((item) => item.connection_id === connectionId) ?? null);
        setMessages((current) => mergeMessages(current, page.messages));
        if (!hasLoadedRef.current) setHasEarlier(page.hasEarlier);
        hasLoadedRef.current = true;
      }
    } catch {
      if (!blocked.current && !abort.signal.aborted) setLoadError(true);
    } finally {
      if (!blocked.current && !abort.signal.aborted) { setLoading(false); setRefreshing(false); }
    }
  }, [connectionId]);

  useFocusEffect(useCallback(() => {
    const timer = setTimeout(() => void refresh(!hasLoadedRef.current), 0);
    return () => { clearTimeout(timer); controller.current?.abort(); };
  }, [refresh]));

  const loadEarlier = useCallback(async () => {
    if (blocked.current || loadingEarlier || !hasEarlier || typeof connectionId !== 'string') return;
    const cursor = getOlderMessageCursor(messages);
    if (!cursor) return;
    setLoadingEarlier(true);
    setLoadError(false);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const page = await loadMessages(connectionId, cursor, abort.signal);
      if (!blocked.current && !abort.signal.aborted) {
        setMessages((current) => mergeMessages(page.messages, current));
        setHasEarlier(page.hasEarlier);
      }
    } catch {
      if (!blocked.current && !abort.signal.aborted) setLoadError(true);
    } finally {
      if (!blocked.current && !abort.signal.aborted) setLoadingEarlier(false);
    }
  }, [connectionId, hasEarlier, loadingEarlier, messages]);

  async function submit() {
    if (blocked.current || typeof connectionId !== 'string') return;
    const normalized = normalizeMessageBody(draft);
    if (!normalized || !beginMessageSend(sendingRef)) return;
    setSending(true);
    setSendError(false);
    const watcher = realtime.current;
    try {
      await sendMessage(connectionId, normalized);
    } catch {
      setSendError(true);
      finishMessageSend(sendingRef);
      setSending(false);
      return;
    }

    setDraft((current) => current === draft ? '' : current);
    if (realtime.current !== watcher || !watcher) {
      finishMessageSend(sendingRef);
      setSending(false);
      return;
    }
    try {
      const abort = new AbortController();
      controller.current = abort;
      const page = await loadMessages(connectionId, null, abort.signal);
      if (!blocked.current && !abort.signal.aborted) {
        setMessages((current) => mergeMessages(current, page.messages));
        requestAnimationFrame(() => list.current?.scrollToEnd({ animated: true }));
      }
    } catch {
      setLoadError(true);
    } finally {
      // Refresh first, then announce the committed send even if refresh failed.
      // Best-effort notification cannot restore the draft or fail the send.
      void watcher.notify();
      finishMessageSend(sendingRef);
      setSending(false);
    }
  }

  function onBlocked() {
    blocked.current = true;
    controller.current?.abort();
    setConnection(null);
    setMessages([]);
    setDraft('');
    const watcher = realtime.current;
    realtime.current = null;
    leaveBlockedChat(() => watcher?.dispose(), () => router.dismissTo('/connections'));
  }

  const canSend = normalizeMessageBody(draft) !== null && !sending;
  return <SafeAreaView style={styles.screen}>
    <StatusBar style="dark" />
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" style={styles.back}
            onPress={() => router.canGoBack() ? router.back() : router.replace('/connections')}>
            <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} size={18} tintColor="#253D2F" accessible={false} />
            <Text style={styles.link}>Back</Text>
          </Pressable>
          <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
            {connection?.first_name ?? 'Conversation'}
          </Text>
          <View style={styles.safetySlot}>
            {typeof connectionId === 'string' && <SafetyActions
              target={{ kind: 'connection', id: connectionId }} onBlocked={onBlocked}
              trigger={<SymbolView name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }} size={22} tintColor="#253D2F" accessible={false} />} />}
          </View>
        </View>

        {loading ? <View style={styles.center}>
          <ActivityIndicator color="#253D2F" />
          <Text style={styles.text}>Loading messages...</Text>
        </View> : !connection ? <View style={styles.center}>
          <Text style={styles.text}>{loadError ? 'Couldn\u2019t load messages. Please try again.' : 'This connection is no longer available.'}</Text>
          <Pressable accessibilityRole="button" style={styles.retry} onPress={() => void refresh(true)}>
            <Text style={styles.link}>Try again</Text>
          </Pressable>
        </View> : <>
          {loadError && <View style={styles.errorRow}>
            <Text accessibilityRole="alert" style={styles.errorText}>Couldn{'’'}t load messages. Please try again.</Text>
            <Pressable accessibilityRole="button" style={styles.retry} onPress={() => void refresh()}><Text style={styles.link}>Retry</Text></Pressable>
          </View>}
          <FlatList ref={list} style={styles.messageViewport} data={messages} keyExtractor={(message) => message.message_id}
            contentContainerStyle={[styles.messageList, messages.length === 0 && styles.emptyList]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor="#253D2F" />}
            ListHeaderComponent={hasEarlier ? <Pressable accessibilityRole="button" disabled={loadingEarlier}
              style={styles.earlier} onPress={() => void loadEarlier()}>
              <Text style={styles.link}>{loadingEarlier ? 'LOADING...' : 'LOAD EARLIER MESSAGES'}</Text>
            </Pressable> : null}
            ListEmptyComponent={<Text style={styles.empty}>No messages yet. Say hello.</Text>}
            renderItem={({ item, index }) => <ChatMessage item={item} previous={messages[index - 1]} next={messages[index + 1]} />}
          />
          {sendError && <Text accessibilityRole="alert" style={styles.sendError}>Couldn{'’'}t send message. Please try again.</Text>}
          <View style={styles.composer}>
            <TextInput accessibilityLabel="Message" multiline maxLength={MESSAGE_MAX_LENGTH}
              placeholder="Write a message..." placeholderTextColor="#858C86" value={draft}
              onChangeText={(value) => { setDraft(value); if (sendError) setSendError(false); }} style={styles.input} />
            <Pressable accessibilityRole="button" accessibilityLabel="Send message" disabled={!canSend}
              accessibilityState={{ disabled: !canSend, busy: sending }}
              onPress={() => void submit()} style={({ pressed }) => [styles.send, !canSend && styles.sendDisabled, pressed && { opacity: 0.7 }]}>
              {sending ? <ActivityIndicator size="small" color="#FEFCF8" />
                : <SymbolView name={{ ios: 'paperplane.fill', android: 'send', web: 'send' }} size={21} tintColor="#FEFCF8" accessible={false} />}
            </Pressable>
          </View>
        </>}
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function sameMessageRun(first: Message | undefined, second: Message | undefined) {
  return !!first && !!second && first.sender_is_me === second.sender_is_me &&
    Math.abs(Date.parse(second.created_at) - Date.parse(first.created_at)) <= 5 * 60 * 1000;
}

export function ChatMessage({ item, previous, next }: { item: Message; previous?: Message; next?: Message }) {
  return <View style={[styles.bubbleRow, item.sender_is_me && styles.outgoingRow,
    { marginTop: !previous ? 0 : sameMessageRun(previous, item) ? 4 : 12 }]}>
    <View style={[styles.bubble, item.sender_is_me ? styles.outgoingBubble : styles.incomingBubble]}>
      <Text style={[styles.body, item.sender_is_me && styles.outgoingBody]}>{item.body}</Text>
    </View>
    {!sameMessageRun(item, next) && <Text style={[styles.time, item.sender_is_me && styles.outgoingTime]}>
      {new Date(item.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
    </Text>}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FEFCF8' }, content: { flex: 1, width: '100%', maxWidth: 620, alignSelf: 'center', paddingHorizontal: 18 },
  header: { minHeight: 62, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#E1E4DE' },
  back: { width: 64, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 3 }, safetySlot: { width: 64, alignItems: 'flex-end' }, title: { flex: 1, textAlign: 'center', fontSize: 22, fontWeight: '600', color: '#202D25' },
  link: { fontSize: 13, fontWeight: '700', color: '#253D2F' }, text: { fontSize: 15, lineHeight: 22, color: '#656D66', textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 }, retry: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
  errorRow: { paddingVertical: 8, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 }, errorText: { flexShrink: 1, fontSize: 13, color: '#7A3E36' },
  messageViewport: { marginHorizontal: -2 },
  messageList: { flexGrow: 1, justifyContent: 'flex-start', paddingVertical: 12 }, emptyList: { justifyContent: 'center' }, empty: { color: '#656D66', fontSize: 16, textAlign: 'center' },
  earlier: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 6 }, bubbleRow: { width: '100%', alignItems: 'flex-start', gap: 4 }, outgoingRow: { alignItems: 'flex-end' },
  bubble: { maxWidth: '78%', borderRadius: 14, paddingHorizontal: 15, paddingVertical: 8 }, incomingBubble: { backgroundColor: '#E4E7E3' },
  outgoingBubble: { backgroundColor: '#E2E9E0' }, body: { color: '#202D25', fontSize: 16, lineHeight: 22 }, outgoingBody: { color: '#202D25' },
  time: { color: '#808880', fontSize: 11, lineHeight: 16, textAlign: 'left' }, outgoingTime: { textAlign: 'right' }, sendError: { color: '#7A3E36', fontSize: 13, textAlign: 'center', paddingVertical: 6 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, borderTopWidth: 1, borderTopColor: '#E1E4DE', paddingVertical: 10 },
  input: { flex: 1, minHeight: 48, maxHeight: 120, borderWidth: 1, borderColor: '#C9CEC7', borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#FEFCF8', color: '#202D25', fontSize: 16 },
  send: { width: 48, height: 48, flexShrink: 0, borderRadius: 24, backgroundColor: '#253D2F', alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { backgroundColor: '#9AA79C' },
});
