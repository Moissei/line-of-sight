const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let cursor = 0, focus, timer, cleanup, owner = 'owner', calls = 0, previews = { 1: 'preview' }, hold = false;
  const preloads = [];
  const state = [], pending = [];
  const jsx = (type, props) => ({ type, props });
  const module = { exports: {} };
  const mocks = {
    '@/components/profile-photo-image': { ProfilePhotoImage: 'ProfilePhotoImage' },
    react: { useState(v) { const i = cursor++; if (!(i in state)) state[i] = v; return [state[i], x => { state[i] = typeof x === 'function' ? x(state[i]) : x; }]; }, useEffect() {}, useRef(v) { const i = cursor++; return state[i] ??= { current: v }; }, useCallback: fn => fn },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'expo-router': { useRouter: () => ({}), useFocusEffect: fn => { focus = fn; } },
    'expo-symbols': {}, 'react-native-safe-area-context': {},
    'react-native': { Image: { prefetch: () => hold ? new Promise(resolve => preloads.push(resolve)) : Promise.resolve(true) }, StyleSheet: { create: x => x } },
    '@/components/profile-status-provider': { useProfileStatus: () => ({ refresh: async () => {} }) },
    '@/lib/profile': { PROFILE_INTENTS: [] },
    '@/lib/profile-photos': { PHOTO_POSITIONS: [1, 2, 3], photoUser: async () => owner, ownPhotoPreviews: async () => previews },
    '@/lib/supabase': { supabase: { from() { const q = { select: () => q, eq: () => q, abortSignal: () => q, maybeSingle() { calls++; return new Promise(resolve => pending.push(resolve)); } }; return q; } } },
  };
  const code = ts.transpileModule(fs.readFileSync('src/app/(tabs)/profile.tsx','utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require','module','exports','setInterval','clearInterval',code)(n => mocks[n],module,module.exports,fn => { timer = fn; return 1; },() => { timer = null; });
  function render() { cursor = 0; return module.exports.default(); }
  render();
  return { state, render, previews(value) { previews = value; }, hold() { hold = true; }, ready() { preloads.splice(0).forEach(resolve => resolve(true)); }, calls: () => calls, focus() { render(); cleanup = focus(); }, blur() { cleanup(); }, tick() { timer?.(); }, timer: () => timer,
    resolve(name) { pending.shift()({ data: { first_name: name, date_of_birth: '2000-01-01', intents: [] }, error: null }); }, owner(value) { owner = value; } };
}
test('ordinary blur retains data, focus replaces it only on success, renewal is serialized', async () => {
  const f = fixture(); f.focus(); await settle(); f.tick(); f.tick(); assert.equal(f.calls(),1);
  f.resolve('Before'); await settle(); assert.equal(f.state[0].first_name,'Before');
  f.blur(); assert.equal(f.timer(),null); assert.equal(f.state[0].first_name,'Before'); assert.deepEqual(f.state[1],{1:'preview'});
  f.focus(); await settle(); assert.equal(f.state[0].first_name,'Before'); f.tick(); assert.equal(f.calls(),2);
  f.resolve('After'); await settle(); assert.equal(f.state[0].first_name,'After');
  f.tick(); await settle(); assert.equal(f.calls(),3); f.blur(); f.resolve('Stale'); await settle(); assert.equal(f.state[0].first_name,'After');
});
test('old focus results cannot overwrite newer focus data and owner mismatch cannot publish', async () => {
  const f = fixture(); f.focus(); await settle(); f.blur(); f.focus(); await settle();
  f.resolve('Old focus'); await settle(); assert.equal(f.state[0],null);
  f.resolve('New focus'); await settle(); assert.equal(f.state[0].first_name,'New focus');
  f.tick(); await settle(); f.owner('different'); f.resolve('Wrong owner'); await settle(); assert.equal(f.state[0],null); assert.deepEqual(f.state[1],{}); f.blur();
});

 test('new targets publish for native handoff; old error cannot remove newer URL', async () => {
  const f=fixture(); f.focus(); await settle(); f.resolve('Before'); await settle();
  function pager(node) { if(!node || typeof node !== 'object') return; if(node.props?.onFailure) return node; for(const child of [node.props?.children].flat(Infinity)) { const found=pager(child); if(found)return found; } }
  const oldError=pager(f.render()).props.onFailure;
  f.blur(); f.previews({1:'replacement'}); f.hold(); f.focus(); await settle(); f.resolve('After'); await settle();
  assert.deepEqual(f.state[1],{1:'replacement'});
  oldError(1,'preview'); assert.deepEqual(f.state[1],{1:'replacement'});
  oldError(1,'replacement'); assert.deepEqual(f.state[1],{}); f.blur();
});
test('missing signed photo removes retained slot, including confirmed deletion', async () => {
  const f=fixture(); f.focus(); await settle(); f.resolve('Before'); await settle(); f.blur();
  f.previews({}); f.focus(); await settle(); f.resolve('After'); await settle(); assert.deepEqual(f.state[1],{}); f.blur();
});
