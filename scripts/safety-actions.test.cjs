const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(path, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const box = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => {
    if (id in dependencies) return dependencies[id];
    throw new Error('Unexpected dependency');
  }, box, box.exports);
  return box.exports;
}
function fixture(kind = 'user') {
  const calls = []; let fail = false, resolve;
  const api = load('src/lib/safety-actions.ts', { './supabase': { supabase: { async rpc(name, params) {
    calls.push({ name, params }); if (resolve === 'wait') await new Promise(r => { resolve = r; });
    return { error: fail ? {} : null };
  } } } });
  const hooks = []; let index = 0, tree, blocked = 0;
  const react = { useState(initial) { const i = index++; if (!(i in hooks)) hooks[i] = initial;
    return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }]; },
  useRef(initial) { const i = index++; return hooks[i] ?? (hooks[i] = { current: initial }); } };
  const jsx = (type, props) => ({ type, props });
  const native = Object.fromEntries(['KeyboardAvoidingView','Modal','Pressable','ScrollView','Text','TextInput','View'].map(x => [x,x]));
  native.Platform = { OS: 'web' }; native.StyleSheet = { create: x => x };
  const { SafetyActions } = load('src/components/safety-actions.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'react-native': native, '@/lib/safety-actions': api,
  });
  function render() { index = 0; tree = SafetyActions({ target: { kind, id: 'internal-target' }, onBlocked: () => { blocked++; } }); return tree; }
  function nodes(value = tree) { if (!value || typeof value !== 'object') return []; if (Array.isArray(value)) return value.flatMap(nodes);
    return [value, ...nodes(value.props?.children ?? null)]; }
  function text(value) { if (typeof value === 'string') return value; if (Array.isArray(value)) return value.map(text).join(''); return value?.props ? text(value.props.children) : ''; }
  function tap(label) { render(); const button = nodes().find(x => x.type === 'Pressable' && text(x) === label); assert.ok(button, label); if (!button.props.disabled) button.props.onPress(); render(); }
  async function settle() { await new Promise(r => setImmediate(r)); render(); }
  render();
  return { api, calls, tap, settle, render, nodes, text: () => text(tree), blocked: () => blocked,
    fail: () => { fail = true; }, hold: () => { resolve = 'wait'; }, release: () => resolve(),
    details(value) { nodes().find(x => x.type === 'TextInput').props.onChangeText(value); render(); } };
}
test('nearby block requires confirmation, locks taps, succeeds once', async () => {
  const f = fixture(); f.tap('More'); f.tap('Block'); assert.equal(f.calls.length, 0);
  assert.match(f.text(), /Block this person\?/); assert.match(f.text(), /send connection requests/);
  f.hold(); f.tap('Block'); f.tap('Submitting...'); await f.settle(); assert.equal(f.calls.length, 1);
  f.release(); await f.settle(); assert.equal(f.blocked(), 1); assert.equal(f.calls[0].name, 'block_user');
  assert.equal(f.text().includes('internal-target'), false);
});
test('block failure leaves usable controls and generic error', async () => {
  const f = fixture(); f.fail(); f.tap('More'); f.tap('Block'); f.tap('Block'); await f.settle();
  assert.equal(f.blocked(), 0); assert.match(f.text(), /complete that action/); f.tap('Block'); await f.settle(); assert.equal(f.calls.length, 2);
});
for (const kind of ['user', 'connection']) test(`${kind} report validates reason/length and never blocks`, async () => {
  const f = fixture(kind); f.tap('More'); f.tap('Report'); f.tap('Submit'); assert.equal(f.calls.length, 0);
  f.tap('\u25cb Harassment'); f.details('x'.repeat(1001)); f.tap('Submit'); assert.equal(f.calls.length, 0);
  f.details('x'.repeat(1000)); f.tap('Submit'); await f.settle();
  assert.equal(f.calls[0].name, `report_${kind}`); assert.equal(f.calls[0].params.details.length, 1000);
  assert.equal(f.blocked(), 0); assert.match(f.text(), /Report submitted/);
  assert.equal(f.api.validReport('Invalid', ''), false);
});
test('connection block RPC, cleanup failure still navigates; report trims', async () => {
  const f = fixture('connection'); f.tap('More'); f.tap('Block'); f.tap('Block'); await f.settle();
  assert.deepEqual(f.calls[0], { name: 'block_connection', params: { connection_id: 'internal-target' } });
  const order = []; f.api.leaveBlockedChat(() => { order.push('dispose'); throw Error(); }, () => order.push('navigate'));
  assert.deepEqual(order, ['dispose', 'navigate']);
  await f.api.performSafetyAction({ kind: 'connection', id: 'internal-target' }, 'report', 'Other', '  details  ');
  assert.equal(f.calls[1].params.details, 'details');
});
test('screen integration preserves privacy, removes nearby row, and clears chat before navigation', () => {
  const discovery = fs.readFileSync('src/app/discovery.tsx', 'utf8');
  assert.match(discovery, /profiles\.filter\(\(item\) => item.user_id !== userId\)/);
  assert.match(discovery, /onBlocked=\{\(\) => removeBlockedProfile\(profile.user_id\)\}/);
  assert.match(discovery, /stopPolling.current = pollNearbyDiscovery\(setNearby\)/);
  const chat = fs.readFileSync('src/app/connection-detail.tsx', 'utf8');
  assert.match(chat, /leaveBlockedChat\(\(\) => watcher\?\.dispose\(\), \(\) => router.dismissTo\('\/connections'\)\)/);
  assert.match(chat, /blocked.current = true/);
  assert.match(chat, /realtime.current = null/);
  const requests = fs.readFileSync('src/app/requests.tsx', 'utf8'); assert.equal(requests.includes('SafetyActions'), false);
  const ui = fs.readFileSync('src/components/safety-actions.tsx', 'utf8');
  assert.equal(ui.includes('console.'), false); assert.equal(ui.includes('{target.id}'), false);
});
// Exercise the real screen callbacks with mocked state/navigation, without native modules.
function screenCallback(path, name, dependencies) {
  const source = ts.createSourceFile(path, fs.readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit); }
  visit(source); assert.ok(found);
  const code = ts.transpileModule(found.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), `${code}; return ${name};`)(...Object.values(dependencies));
}
test('actual nearby success callback removes row, disposes cache, and restarts refresh', () => {
  let state = { status: 'ready', profiles: [{ user_id: 'blocked', primaryPhotoUrl: 'memory-only' }, { user_id: 'other' }] };
  let stopped = 0, restarted = 0;
  const stopPolling = { current: () => stopped++ };
  const callback = screenCallback('src/app/discovery.tsx', 'removeBlockedProfile', {
    stopPolling, presenceVerified: { current: true }, setNearby: update => { state = update(state); },
    pollNearbyDiscovery: () => { restarted++; return () => {}; },
  });
  callback('blocked'); assert.equal(stopped, 1); assert.equal(restarted, 1);
  assert.deepEqual(state.profiles, [{ user_id: 'other' }]);
});
test('actual chat success clears state, cancels work, disposes channel, navigates', () => {
  const f = fixture(); const order = []; const blocked = { current: false };
  const realtime = { current: { dispose() { order.push('dispose'); } } };
  const callback = screenCallback('src/app/connection-detail.tsx', 'onBlocked', {
    blocked, realtime, controller: { current: { abort() { order.push('abort'); } } },
    setConnection: x => assert.equal(x, null), setMessages: x => assert.deepEqual(x, []), setDraft: x => assert.equal(x, ''),
    leaveBlockedChat: f.api.leaveBlockedChat, router: { dismissTo: path => { assert.equal(path, '/connections'); order.push('navigate'); } },
  });
  callback(); assert.equal(blocked.current, true); assert.equal(realtime.current, null);
  assert.deepEqual(order, ['abort', 'dispose', 'navigate']);
});
test('report failure permits retry; exact reasons and lock cover stale duplicate handlers', async () => {
  const f = fixture(); assert.deepEqual([...f.api.REPORT_REASONS], ['Harassment','Spam','Fake profile','Inappropriate content','Safety concern','Other']);
  f.fail(); f.tap('More'); f.tap('Report'); f.tap('\u25cb Other'); f.tap('Submit'); await f.settle();
  assert.match(f.text(), /complete that action/); f.tap('Submit'); await f.settle(); assert.equal(f.calls.length, 2); assert.equal(f.blocked(), 0);
  const lock = { current: false }; let release, count = 0;
  const pending = f.api.runSafetyAction(lock, async () => { count++; await new Promise(r => { release = r; }); });
  assert.equal(await f.api.runSafetyAction(lock, async () => { count++; }), false);
  release(); await pending; assert.equal(count, 1); assert.equal(lock.current, false);
});
