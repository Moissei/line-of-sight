const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(tab) {
  let cursor = 0, effect, cleanup, tree;
  const state = [], pending = [], responses = [];
  const timers = new Map(); let timerId = 0;
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return state[i] ??= { current: initial }; }, useCallback: fn => fn,
  };
  const native = { StyleSheet: { create: x => x } };
  for (const name of ['Pressable', 'RefreshControl', 'ScrollView', 'Text', 'View']) native[name] = name;
  const load = signal => new Promise((resolve, reject) => pending.push({ resolve, reject, signal }));
  const dependencies = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    'expo-router': { useFocusEffect: fn => { effect = fn; }, useRouter: () => ({}) },
    'expo-status-bar': {}, 'expo-symbols': {}, 'react-native-safe-area-context': {},
    '@/lib/connections': { loadConnections: load },
    '@/lib/incoming-requests': { loadIncomingRequests: load, respondToRequest: (...args) => new Promise(resolve => responses.push({ args, resolve })) },
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(`src/app/(tabs)/${tab}.tsx`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'exports', 'setTimeout', 'clearTimeout', code)(name => dependencies[name], exports, fn => { timers.set(++timerId, fn); return timerId; }, id => timers.delete(id));
  function render() { cursor = 0; tree = exports.default(); return tree; }
  function nodes(n = tree) { return !n || typeof n !== 'object' ? [] : [n, ...[n.props?.children].flat(Infinity).filter(child => child !== undefined).flatMap(child => nodes(child))]; }
  render();
  return { state, pending, responses, render, nodes, focus() { render(); cleanup = effect(); for (const [id, fn] of timers) { timers.delete(id); fn(); } }, blur() { cleanup(); } };
}
const row = id => ({ connection_id: id, request_id: id, first_name: 'Test', age: null, gender: null, bio: null, intents: [] });
for (const tab of ['connections', 'requests']) {
  test(`${tab}: retained rows survive refocus and failure; successful refresh is authoritative`, async () => {
    const f = fixture(tab); f.focus(); await settle(); f.pending.shift().resolve([row('one')]); await settle();
    f.blur(); f.focus(); await settle(); assert.equal(f.state[0][0].first_name, 'Test');
    f.pending.shift().reject(Error('private')); await settle(); assert.equal(f.state[0].length, 1);
    f.blur(); f.focus(); await settle(); f.pending.shift().resolve([]); await settle(); assert.deepEqual(f.state[0], []); f.blur();
  });
  test(`${tab}: aborted older focus cannot overwrite authoritative newer result`, async () => {
    const f = fixture(tab); f.focus(); await settle(); const old = f.pending.shift(); f.blur(); assert.equal(old.signal.aborted, true);
    f.focus(); await settle(); f.pending.shift().resolve([row('new')]); await settle(); old.resolve([row('old')]); await settle();
    assert.equal(f.state[0][0].request_id, 'new'); f.blur();
  });
}
test('Connections pull-to-refresh retains rows and requests fresh data', async () => {
  const f = fixture('connections'); f.focus(); await settle(); f.pending.shift().resolve([row('one')]); await settle(); f.render();
  const scroll = f.nodes().find(n => n.type === 'ScrollView'); scroll.props.refreshControl.props.onRefresh();
  assert.equal(f.state[0].length, 1); f.pending.shift().resolve([]); await settle(); assert.deepEqual(f.state[0], []); f.blur();
});
for (const response of ['accepted', 'declined']) test(`Requests ${response} removes row only after confirmation and locks duplicate actions`, async () => {
  const f = fixture('requests'); f.focus(); await settle(); f.pending.shift().resolve([row('one')]); await settle(); f.render();
  const buttons = f.nodes().filter(n => n.type === 'Pressable'); const press = buttons[response === 'accepted' ? 0 : 1].props.onPress;
  press(); press(); assert.equal(f.responses.length, 1); assert.equal(f.state[0].length, 1);
  assert.deepEqual(f.responses[0].args, ['one', response]); f.responses[0].resolve(); await settle(); assert.deepEqual(f.state[0], []); f.blur();
});

for (const tab of ['connections', 'requests']) test(`${tab}: loaded empty state remains during background refresh without loading branch`, async () => {
  const f = fixture(tab); f.focus(); await settle(); assert.equal(f.state[1], true);
  f.pending.shift().resolve([]); await settle(); f.blur(); f.focus(); await settle();
  assert.equal(f.state[1], false); f.render();
  assert.ok(!JSON.stringify(f.render()).includes(tab === 'connections' ? 'Loading connections...' : 'Loading requests...'));
  if (tab === 'connections') {
    const scroll = f.nodes().find(n => n.type === 'ScrollView');
    assert.equal(scroll.props.refreshControl.props.refreshing, false);
    scroll.props.refreshControl.props.onRefresh(); f.render();
    assert.equal(f.nodes().find(n => n.type === 'ScrollView').props.refreshControl.props.refreshing, true);
  }
  f.blur();
});
