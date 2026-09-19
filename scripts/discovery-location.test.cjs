const fs = require('node:fs');
const ts = require('typescript');
const test = require('node:test');
const assert = require('node:assert/strict');
const source = fs.readFileSync('src/lib/discovery-presence.ts', 'utf8');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const fix = () => ({ timestamp: 10000, coords: { latitude: 12, longitude: 34, accuracy: 5 } });
function fixture(options = {}) {
  let now = 10000, writes = 0, currents = 0, permissions = 0, caches = 0, active;
  const pending = []; let callback, errorCallback, resolveHandle, rejectHandle, removals = 0, cacheResolve;
  const timers = new Map(); let timerId = 0;
  const handle = { remove() { removals++; } };
  const client = {
    auth: { async getUser() { if (options.authFailure) throw Error('private'); return { data: { user: { id: 'fixture' } } }; } },
    from() {
      if (options.staleAtWrite) now += 3001;
      return {
        upsert(value) { writes++; active = value.is_active; assert.deepEqual(Object.keys(value).sort(), ['expires_at', 'is_active', 'latitude', 'longitude', 'user_id']); return this; },
        update(value) { active = value.is_active; return this; }, eq() { return this; }, select() { return this; },
        async single() { if (options.writeFailure) throw Error('private'); return { data: { is_active: active, updated_at: new Date(now).toISOString(), expires_at: null } }; },
      };
    },
  };
  const location = {
    Accuracy: { High: 4, Balanced: 3 },
    async requestForegroundPermissionsAsync() { permissions++; if (options.permissionFailure) throw Error('private'); return { granted: !options.denied, android: { accuracy: options.coarse ? 'coarse' : 'fine' } }; },
    async getLastKnownPositionAsync(opts) { caches++; assert.deepEqual(opts, { maxAge: 3000, requiredAccuracy: 15 }); if (options.cachePending) return new Promise(r => { cacheResolve = r; }); if (options.cacheThrows) throw Error('private'); return 'cached' in options ? options.cached : fix(); },
    watchPositionAsync(opts, cb, error) {
      currents++; callback = cb; errorCallback = error;
      assert.deepEqual(opts, { accuracy: 4, timeInterval: 1000, distanceInterval: 0, mayShowUserSettingsDialog: false });
      if (options.setupReject) return Promise.reject(Error('private'));
      if (!options.manual) cb(options.current ?? fix());
      if (options.delayedHandle) return new Promise((resolve, reject) => { resolveHandle = resolve; rejectHandle = reject; });
      return Promise.resolve(handle);
    },
    async getCurrentPositionAsync(opts) { currents++; assert.deepEqual(opts, { accuracy: options.ios ? 3 : 4 }); return options.current ?? fix(); },
  };
  class Clock extends Date { static now() { return now; } }
  const exports = {};
  new Function('require', 'exports', '__DEV__', 'Date', 'performance', 'setTimeout', 'clearTimeout', 'console', code)(id => id === 'expo-location' ? location : id === 'react-native' ? { Platform: { OS: options.ios ? 'ios' : 'android' } } : { supabase: client }, exports, false, Clock, { now: () => now }, (fn, ms) => { const id = ++timerId; timers.set(id, { fn, at: now + ms }); return id; }, id => timers.delete(id), { log() { assert.fail('Production emitted temporary diagnostics'); } });
  return { start: signal => exports.setDiscoveryPresence(true, value => pending.push(value), signal), stop: () => exports.setDiscoveryPresence(false), pending,
    emit: location => callback(location), fail: () => errorCallback('private'),
    handle: () => resolveHandle(handle), rejectHandle: () => rejectHandle(Error('private')), cache: location => cacheResolve(location),
    removals: () => removals, timers: () => timers.size,
    advance(ms, run = true) { now += ms; if (run) for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); } },
    counts: () => ({ writes, currents, permissions, caches }) };
}
test('acceptable cache skips acquisition; exact age and accuracy boundaries accepted', async () => {
  for (const cached of [fix(), { timestamp: 7000, coords: { ...fix().coords, accuracy: 15 } }]) {
    const f = fixture({ cached }); assert.equal(await f.start(), true);
    assert.equal(f.counts().currents, 0); assert.equal(f.counts().writes, 1); assert.deepEqual(f.pending, [true, false]);
  }
});
test('watcher rejects just above 15m and accepts exactly 15m', async () => {
  const f = fixture({ cached: { ...fix(), coords: { ...fix().coords, accuracy: 15.01 } }, manual: true });
  const p = f.start(); await flush();
  assert.equal(f.counts().currents, 1);
  f.emit({ ...fix(), coords: { ...fix().coords, accuracy: 15.01 } });
  assert.equal(f.counts().writes, 0);
  f.emit({ timestamp: 7000, coords: { ...fix().coords, accuracy: 15 } });
  assert.equal(await p, true); assert.equal(f.counts().writes, 1);
});
test('server discovery still enforces spheroidal 20m radius', () => {
  const sql = fs.readFileSync('supabase/migrations/20260919000100_discovery_without_distance.sql', 'utf8');
  assert.match(sql, /v_radius_meters constant double precision := 20\.0;/);
  assert.match(sql, /extensions\.st_dwithin\(v_origin, c\.position, v_radius_meters, true\)/);
});
const invalid = [null, { ...fix(), timestamp: 6999 }, { ...fix(), timestamp: 10001 },
  ...[undefined, NaN, Infinity].map(timestamp => ({ ...fix(), timestamp })),
  ...[undefined, null, NaN, Infinity, 0, -1, 15.01].map(accuracy => ({ ...fix(), coords: { ...fix().coords, accuracy } })),
  ...[NaN, Infinity, 91, -91].map(latitude => ({ ...fix(), coords: { ...fix().coords, latitude } })),
  ...[NaN, Infinity, 181, -181].map(longitude => ({ ...fix(), coords: { ...fix().coords, longitude } })),
];
test('missing or invalid cache creates High watcher and acceptable fix writes', async () => {
  for (const cached of invalid) { const f = fixture({ cached }); await f.start(); assert.equal(f.counts().currents, 1); assert.equal(f.counts().writes, 1); }
  const f = fixture({ cacheThrows: true }); await f.start(); assert.equal(f.counts().currents, 1);
});
test('unacceptable watcher fixes never write presence and time out', async () => {
  for (const current of invalid.filter(Boolean)) { const f = fixture({ cached: null, current }); const attempt = f.start(); await flush(); assert.equal(f.counts().writes, 0); f.advance(8000); await assert.rejects(attempt); assert.deepEqual(f.pending, [true, false]); }
});
test('fix becoming stale before write fails without retry or stale write', async () => {
  const f = fixture({ staleAtWrite: true }); await assert.rejects(f.start()); assert.equal(f.counts().writes, 0);
});
test('one START ignores multiple poor fixes then accepts first qualifying fix and removes once', async () => {
  const f = fixture({ cached: null, manual: true }); const attempt = f.start(); await flush();
  for (const location of invalid) f.emit(location);
  assert.equal(f.counts().writes, 0);
  f.emit(fix()); await attempt;
  f.emit(fix()); f.fail(); f.advance(8000);
  assert.equal(f.counts().writes, 1); assert.equal(f.removals(), 1); assert.equal(f.timers(), 0);
});
test('watcher deadline is checked even when the JS timer has not fired', async () => {
  const f = fixture({ cached: null, manual: true }); const p = f.start(); await flush();
  f.advance(8000, false); f.emit({ ...fix(), timestamp: 18000 });
  await assert.rejects(p, /accurate location yet/); assert.equal(f.counts().writes, 0); assert.equal(f.removals(), 1);
});
test('cached lookup and watcher share the original budget', async () => {
  const f = fixture({ cachePending: true, manual: true }); const p = f.start(); await flush();
  f.advance(6000); f.cache(null); await flush(); f.advance(2000);
  await assert.rejects(p, /accurate location yet/); assert.equal(f.removals(), 1);
});
test('cache timeout prevents a late cache result from creating a watcher', async () => {
  const f = fixture({ cachePending: true }); const p = f.start(); await flush(); f.advance(8000);
  await assert.rejects(p); f.cache(null); await flush(); assert.equal(f.counts().currents, 0);
});
test('callback before handle removes eventual handle exactly once', async () => {
  const f = fixture({ cached: null, delayedHandle: true }); await f.start();
  assert.equal(f.removals(), 0); f.handle(); await flush(); assert.equal(f.removals(), 1);
});
for (const reason of ['cancel', 'timeout', 'error']) {
  test(`${reason} before handle ignores late callbacks and blocks overlapping setup`, async () => {
    const f = fixture({ cached: null, manual: true, delayedHandle: true }); const c = new AbortController();
    const p = f.start(c.signal); await flush();
    if (reason === 'cancel') c.abort(); else if (reason === 'timeout') f.advance(8000); else f.fail();
    await assert.rejects(p); await assert.rejects(f.start());
    assert.equal(f.counts().currents, 1); f.emit(fix()); assert.equal(f.counts().writes, 0);
    f.handle(); await flush(); assert.equal(f.removals(), 1);
  });
}
test('setup rejection and rejection after cancellation are handled', async () => {
  const f = fixture({ cached: null, setupReject: true }); await assert.rejects(f.start()); assert.equal(f.timers(), 0);
  const g = fixture({ cached: null, manual: true, delayedHandle: true }); const c = new AbortController();
  const p = g.start(c.signal); await flush(); c.abort(); await assert.rejects(p);
  g.rejectHandle(); await flush(); assert.equal(g.counts().writes, 0);
});
test('cancelled signal prevents permission and location acquisition', async () => {
  const f = fixture(); const c = new AbortController(); c.abort(); await assert.rejects(f.start(c.signal));
  assert.equal(f.counts().permissions, 0); assert.equal(f.counts().writes, 0);
});
test('coarse permission rejects without location acquisition or write', async () => {
  const f = fixture({ coarse: true }); await assert.rejects(f.start(), /Precise Location/);
  assert.deepEqual(f.counts(), { writes: 0, currents: 0, caches: 0, permissions: 1 });
});
test('STOP performs no permission or location requests', async () => {
  const f = fixture(); assert.equal(await f.stop(), false);
  assert.deepEqual(f.counts(), { writes: 0, currents: 0, caches: 0, permissions: 0 });
});
test('START STOP START continues to perform one acquisition per explicit START', async () => {
  const f = fixture({ cached: null });
  assert.equal(await f.start(), true);
  assert.equal(await f.stop(), false);
  assert.equal(await f.start(), true);
  assert.deepEqual(f.counts(), { writes: 2, currents: 2, caches: 2, permissions: 2 });
});
for (const failure of ['authFailure', 'permissionFailure', 'denied', 'writeFailure']) {
  test(`${failure} rejects START without reporting success`, async () => {
    const f = fixture({ [failure]: true });
    await assert.rejects(f.start());
    assert.equal(f.counts().writes, failure === 'writeFailure' ? 1 : 0);
    if (failure !== 'authFailure') assert.deepEqual(f.pending, [true, false]);
  });
}
test('iOS keeps Balanced acquisition without Android cache or permission gate', async () => {
  const f = fixture({ ios: true, coarse: true }); await f.start(); assert.equal(f.counts().caches, 0);
});
test('no background collection or persisted cache is introduced', () => {
  assert.doesNotMatch(source, /startLocationUpdates|AsyncStorage|requestBackgroundPermissions/);
});
for (const lifecycle of ['success', 'blur', 'unmount', 'background']) test(`screen START handles ${lifecycle}, protects duplicate taps and confirmed activation`, async () => {
  const values = []; let index = 0, tree, collect = true, calls = 0, locationPending, confirm, onAppState, operationSignal;
  const effects = [];
  const react = {
    useState(initial) { const n = index++; if (!(n in values)) values[n] = initial; return [values[n], value => { values[n] = typeof value === 'function' ? value(values[n]) : value; }]; },
    useRef(initial) { const n = index++; return values[n] ?? (values[n] = { current: initial }); },
    useCallback(fn) { return fn; },
  };
  const jsx = (type, props) => ({ type, props });
  const native = { AppState: { addEventListener: (event, cb) => { onAppState = cb; return { remove() {} }; } }, StyleSheet: { create: x => x }, useWindowDimensions: () => ({ width: 400, height: 800 }) };
  for (const name of ['Pressable', 'ScrollView', 'Text', 'View']) native[name] = name;
  const dependencies = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    'expo-router': { useFocusEffect(fn) { if (collect) effects.push(fn); } },
    'expo-status-bar': { StatusBar: 'StatusBar' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    '@/lib/discovery-presence': { readDiscoveryPresence: async () => false, presenceErrorMessage: () => 'Error',
      setDiscoveryPresence(active, pending, signal) { calls++; operationSignal = signal; locationPending = pending; pending(true); return new Promise((resolve, reject) => { confirm = resolve; signal?.addEventListener('abort', () => { pending(false); reject(Error('cancelled')); }); }); } },
    '@/lib/nearby-discovery': { pollNearbyDiscovery: () => () => {} },
    '@/components/nearby-profile-card': { NearbyProfileCard: 'Card' },
    '@/components/discovery-brand': { DiscoveryBrand: 'Brand' },
  };
  const screen = ts.transpileModule(fs.readFileSync('src/app/(tabs)/discovery.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function('require', 'exports', screen)(id => { assert.ok(id in dependencies, id); return dependencies[id]; }, exports);
  function render() { index = 0; tree = exports.default(); }
  function nodes(node) { if (!node || typeof node !== 'object') return []; return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)]; }
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  render(); collect = false; const cleanup = effects[0](); await flush(); render();
  const press = nodes(tree).find(n => n.type === 'Pressable').props.onPress;
  press(); press(); render();
  assert.equal(calls, 1);
  assert.match(JSON.stringify(tree), /Getting your location…/);
  assert.match(JSON.stringify(tree), /SESSION INACTIVE/);
  if (lifecycle !== 'success') {
    if (lifecycle === 'background') onAppState('background'); else cleanup();
    assert.equal(operationSignal.aborted, true); await flush();
    locationPending(true); confirm(true); await flush(); render();
    assert.doesNotMatch(JSON.stringify(tree), /SESSION ACTIVE/);
    return;
  }
  locationPending(false); render(); assert.match(JSON.stringify(tree), /SESSION INACTIVE/);
  confirm(true); await flush(); render(); assert.match(JSON.stringify(tree), /SESSION ACTIVE/);
  assert.doesNotMatch(JSON.stringify(tree), /Getting your location…/);
});
