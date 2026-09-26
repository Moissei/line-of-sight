const fs = require('node:fs');
const ts = require('typescript');
const test = require('node:test');
const assert = require('node:assert/strict');
const source = fs.readFileSync('src/app/connection-detail.tsx', 'utf8');
const jsx = (type, props) => ({ type, props });
function load(draft = '', sending = false) {
 const values = [{ first_name: 'Alex' }, [], false, false, false, false, false, draft, sending, false];
 const native = { StyleSheet: { create: x => x }, Platform: { OS: 'ios' } };
 for (const name of ['View', 'Text', 'Pressable', 'FlatList', 'TextInput', 'KeyboardAvoidingView', 'RefreshControl']) native[name] = name;
 const deps = { react: { useState: () => [values.shift(), () => {}], useRef: x => ({ current: x }), useCallback: fn => fn },
 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
 'expo-router': { useLocalSearchParams: () => ({ connectionId: 'connection-test' }), useRouter: () => ({}), useFocusEffect() {} },
 '@/lib/messages': { normalizeMessageBody: s => s.trim() || null, MESSAGE_MAX_LENGTH: 2000 } };
 const exports = {};
 const code = ts.transpileModule(source + '\nexport { styles };', { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
 new Function('require', 'exports', code)(id => deps[id] ?? {}, exports);
 return exports;
}
const message = (minute, mine = true) => ({ message_id: String(minute), sender_is_me: mine, body: 'Hello', created_at: new Date(Date.UTC(2026, 0, 1, 12, minute)).toISOString() });
function nodes(n) { return !n || typeof n !== 'object' ? [] : [n, ...[n.props?.children].flat(Infinity).flatMap(nodes)]; }
test('same-sender five-minute runs use tight spacing and one external final timestamp', () => {
 const m = load(); const first = m.ChatMessage({ item: message(0), next: message(5) });
 assert.equal(nodes(first).filter(n => n.type === 'Text').length, 1);
 const last = m.ChatMessage({ item: message(5), previous: message(0) });
 assert.equal(last.props.style[2].marginTop, 4);
 assert.equal(last.props.children[0].props.children.type, 'Text');
 assert.equal(last.props.children[1].type, 'Text');
 assert.equal(last.props.children[1].props.children, new Date(message(5).created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
});
for (const next of [message(6), message(1, false)]) test('time gap or sender change starts separate group: ' + next.created_at + next.sender_is_me, () => {
 const m = load(); assert.ok(m.ChatMessage({ item: message(0), next }).props.children[1]);
 assert.equal(m.ChatMessage({ item: next, previous: message(0) }).props.style[2].marginTop, 12);
});
test('incoming and outgoing bubbles retain alignment and use compact borderless geometry', () => {
 const m = load();
 assert.equal(m.styles.bubble.borderRadius, 14); assert.equal(m.styles.bubble.paddingVertical, 8);
 assert.equal(m.styles.bubble.maxWidth, '78%'); assert.equal(m.styles.incomingBubble.borderWidth, undefined);
 assert.equal(m.styles.incomingBubble.backgroundColor, '#E4E7E3'); assert.equal(m.styles.outgoingBubble.backgroundColor, '#E2E9E0');
 assert.equal(m.styles.content.paddingHorizontal, 18);
 assert.equal(m.styles.body.color, '#202D25'); assert.equal(m.styles.outgoingBody.color, '#202D25');
 assert.equal(m.styles.incomingBubble.borderBottomLeftRadius, undefined); assert.equal(m.styles.outgoingBubble.borderBottomRightRadius, undefined);
 assert.equal(m.styles.bubbleRow.alignItems, 'flex-start'); assert.equal(m.styles.outgoingRow.alignItems, 'flex-end');
 assert.equal(m.ChatMessage({ item: message(0, false) }).props.children[0].props.style[1], m.styles.incomingBubble);
});
for (const [draft, sending, disabled] of [['', false, true], ['   ', false, true], ['Hello', false, false], ['Hello', true, true]]) test('composer state ' + JSON.stringify([draft, sending]), () => {
 const m = load(draft, sending); const tree = m.default(); const all = nodes(tree);
 const input = all.find(n => n.type === 'TextInput'); assert.equal(input.props.placeholder, 'Write a message...'); assert.equal(input.props.multiline, true);
 const send = all.find(n => n.props.accessibilityLabel === 'Send message'); assert.equal(send.props.disabled, disabled); assert.equal(typeof send.props.onPress, 'function');
 const style = Object.assign({}, ...send.props.style({ pressed: false }).filter(Boolean)); assert.equal(style.backgroundColor, disabled ? '#9AA79C' : '#253D2F'); assert.equal(style.width, 48);
 const list = all.find(n => n.type === 'FlatList'); assert.equal(list.props.inverted, undefined); assert.equal(list.props.scrollEnabled, undefined);
 assert.equal(m.styles.messageList.flexGrow, 1); assert.equal(m.styles.messageList.justifyContent, 'flex-start');
 assert.equal(all.find(n => n.type === 'KeyboardAvoidingView').props.behavior, 'padding');
});
test('existing send identity, pagination, latest scrolling and realtime wiring remain', () => {
 assert.match(source, /await sendMessage\(connectionId, normalized\)/);
 assert.match(source, /watchMessageChanges\(supabase, connectionId, reloadNewest\)/);
 assert.match(source, /getOlderMessageCursor\(messages\)/);
 assert.match(source, /scrollToEnd\(\{ animated: true \}\)/);
 assert.match(source, /beginMessageSend\(sendingRef\)/);
});

test('both message directions and external timestamps share symmetric 16px page insets', () => {
 const m = load();
 assert.equal(m.styles.content.paddingHorizontal + m.styles.messageViewport.marginHorizontal, 16);
 assert.equal(m.styles.bubbleRow.width, '100%');
 for (const mine of [false, true]) {
  const row = m.ChatMessage({ item: message(0, mine) });
  const style = Object.assign({}, ...row.props.style.filter(Boolean));
  assert.equal(style.alignItems, mine ? 'flex-end' : 'flex-start');
  assert.equal(row.props.children[0].type, 'View'); assert.equal(row.props.children[1].type, 'Text');
  assert.equal(row.props.children[1].props.style[0].color, '#808880');
 }
 const list = nodes(m.default()).find(n => n.type === 'FlatList');
 assert.equal(list.props.style, m.styles.messageViewport);
 assert.equal(list.props.ListFooterComponent, undefined);
});
