const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file, mocks) {
  const m = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', code)(n => { if (!(n in mocks)) throw Error('Unexpected dependency: ' + n); return mocks[n]; }, m, m.exports);
  return m.exports;
}
const positions = [1, 2, 3];
const photo = uri => ({ uri, file: undefined, fileSize: undefined, mimeType: 'image/jpeg' });
const replace = uri => ({ kind: 'replace', photo: photo(uri) });
const draftApi = load('src/lib/profile-photo-draft.ts', {
  './profile-photo': { validatePhoto: p => p.mimeType === 'bad' ? 'Invalid photo' : null },
  './profile-photos': { PHOTO_POSITIONS: positions },
});
function editor(remote = [1, 2, 3]) {
  let draft = { photoOwner: 'owner', photos: {} }, cursor = 0, focus, cleanup, result, pickerCalls = [], pending;
  const state = [], effects = [];
  const setDraft = f => { draft = typeof f === 'function' ? f(draft) : f; };
  const jsx = (type, props) => ({ type, props });
  const api = load('src/components/profile-photo-slots.tsx', {
    react: { useState(v) { const i = cursor++; if (!(i in state)) state[i] = v; return [state[i], v => { state[i] = typeof v === 'function' ? v(state[i]) : v; }]; }, useRef(v) { const i = cursor++; return state[i] ??= { current: v }; }, useCallback: f => f, useEffect: f => effects.push(f) },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', Image: 'Image', StyleSheet: { create: v => v } },
    'expo-symbols': { SymbolView: 'Symbol' }, 'expo-router': { useFocusEffect: f => { focus = f; } },
    './onboarding-provider': { useOnboarding: () => ({ draft, setDraft }) },
    '@/lib/profile-photo-draft': draftApi,
    '@/lib/profile-photos': { PHOTO_POSITIONS: positions, photoUser: async () => 'owner', readEditorPhotos: async () => ({ positions: remote, previews: Object.fromEntries(remote.map(p => [p, 'remote' + p])) }) },
    'expo-image-picker': { launchImageLibraryAsync: async options => { pickerCalls.push(options); return pending ? new Promise(resolve => { pending = resolve; }) : result; } },
  });
  function render() { cursor = 0; const nodes = []; const walk = n => { if (!n || typeof n !== 'object') return; nodes.push(n); const c = n.props?.children; (Array.isArray(c) ? c.flat(Infinity) : [c]).forEach(walk); }; walk(api.ProfilePhotoSlots({ editing: true, onBusy() {} })); return nodes; }
  async function settle() { await new Promise(r => setTimeout(r, 5)); }
  return { render, draft: () => draft, calls: pickerCalls, async focus() { render(); cleanup = focus(); await settle(); render(); }, blur() { cleanup(); }, async pick(assets, slot) { result = assets === null ? { canceled: true } : { canceled: false, assets }; const n = render().find(n => slot ? n.props?.accessibilityLabel?.includes('photo in slot ' + slot) : n.props?.accessibilityLabel === 'Add/Replace Photos'); n.props.onPress(); await settle(); }, remove(slot) { render().find(n => n.props?.accessibilityLabel === 'Remove photo ' + slot).props.onPress(); }, defer() { pending = true; }, resolve(assets) { pending({ canceled: false, assets }); pending = undefined; }, settle };
}
for (const remote of [[1, 2, 3], [1, 3], []]) for (const count of [1, 2, 3]) {
  test('multi-pick ' + count + ' replaces from 1 with occupied slots ' + remote.join(','), async () => {
    const f = editor(remote); await f.focus();
    try { await f.pick(['X', 'Y', 'Z'].slice(0, count).map(photo));
      for (const p of positions) assert.deepEqual(f.draft().photos[p], p <= count ? replace(['X', 'Y', 'Z'][p - 1]) : undefined);
      assert.deepEqual(f.calls[0], { mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 3, orderedSelection: true, allowsEditing: false, quality: 1 });
    } finally { f.blur(); }
  });
}
test('individual selection affects only its slot; latest action wins across removal and multi-pick', async () => {
  const f = editor(); await f.focus();
  try {
    f.remove(1); assert.deepEqual(f.draft().photos, { 1: { kind: 'remove' } });
    await f.pick([photo('X'), photo('Y')]); assert.deepEqual(f.draft().photos[1], replace('X'));
    f.remove(3); await f.pick([photo('A'), photo('B')]); assert.deepEqual(f.draft().photos[3], { kind: 'remove' });
    await f.pick(['X','Y','Z'].map(photo)); f.remove(2); assert.deepEqual(f.draft().photos[2], { kind: 'remove' });
    await f.pick(['X','Y','Z'].map(photo));
    await f.pick([photo('new')], 2);
    assert.deepEqual(f.draft().photos, { 1: replace('X'), 2: replace('new'), 3: replace('Z') });
    assert.equal(f.calls.at(-1).allowsMultipleSelection, false); assert.equal(f.calls.at(-1).selectionLimit, 1);
  } finally { f.blur(); }
});
test('cancel, invalid batch and excess results preserve the entire draft', async () => {
  const f = editor(); await f.focus();
  try {
    await f.pick([photo('old')], 3); const before = f.draft();
    for (const batch of [null, [photo('valid'), { uri: 'bad', mimeType: 'bad' }], Array(4).fill(photo('extra')), []]) {
      await f.pick(batch); assert.equal(f.draft(), before);
    }
  } finally { f.blur(); }
});
test('blur/refocus discards photo draft and ignores a late picker; duplicate taps launch once', async () => {
  const f = editor(); await f.focus();
  try {
    f.remove(1); f.defer(); await f.pick([photo('late')]); await f.pick([photo('duplicate')]); assert.equal(f.calls.length, 1);
    f.blur(); await f.focus(); f.resolve([photo('late')]); await f.settle();
    assert.deepEqual(f.draft().photos, {});
    await f.pick([photo('fresh')], 3); assert.deepEqual(f.draft().photos[3], replace('fresh'));
  } finally { f.blur(); }
});
function persistence() {
  const events = [], objects = new Set(['1','2','3']), rows = new Set([1,2,3]); let failMetadata = false;
  const storage = { list: async () => ({ data: [...objects].map(name => ({ name })) }), createSignedUrl: async path => ({ data: { signedUrl: path } }), upload: async path => { events.push('upload:' + path); objects.add(path.split('/')[1]); return {}; }, remove: async paths => { events.push('remove:' + paths[0]); objects.delete(paths[0].split('/')[1]); return {}; } };
  const supabase = { auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) }, storage: { from: () => storage }, from(table) {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: {} }), then: resolve => resolve({ data: [...rows].map(position => ({ position })) }),
      upsert: async v => { events.push('metadata:' + v.position); if (failMetadata) { failMetadata = false; return { error: true }; } rows.add(v.position); return {}; },
      delete: () => ({ eq: () => ({ eq: async (_key,p) => { events.push('delete:' + p); rows.delete(p); return {}; } }) }) };
    assert.ok(['profiles','profile_photos'].includes(table)); return q;
  } };
  const api = load('src/lib/profile-photos.ts', { './supabase': { supabase }, './profile-photo': { readProfilePhoto: async p => { events.push('sanitize:' + p.uri); return { body: new ArrayBuffer(1), contentType: 'image/jpeg' }; } } });
  return { api, events, objects, fail() { failMetadata = true; } };
}
test('editor initialization reads and signs without mutations, even with legacy object', async () => {
  const f = persistence(); f.objects.delete('1'); f.objects.add('profile');
  const state = await f.api.readEditorPhotos('owner'); assert.deepEqual(state.positions, [1,2,3]); assert.equal(state.previews[1], 'owner/profile'); assert.deepEqual(f.events, []);
});
test('Save mixed operations sanitize replacements, remove explicitly, and leave unchanged slots untouched', async () => {
  const f = persistence(); await f.api.saveSelectedPhotos('owner', { 1: replace('X'), 2: { kind: 'remove' }, 3: { kind: 'unchanged' } });
  assert.deepEqual(f.events, ['sanitize:X','upload:owner/1','metadata:1','remove:owner/2','delete:2']);
  f.events.length = 0; await f.api.saveSelectedPhotos('owner', {}); assert.deepEqual(f.events, []);
});
test('failed Save retains draft; retry repeats canonical operations without deleting replacement', async () => {
  const f = persistence(); const draft = { 1: { kind: 'remove' }, 2: replace('Y') }; const before = JSON.stringify(draft);
  f.fail(); await assert.rejects(f.api.saveSelectedPhotos('owner', draft)); assert.equal(JSON.stringify(draft), before);
  await f.api.saveSelectedPhotos('owner', draft); assert.equal(JSON.stringify(draft), before);
  assert.equal(f.events.includes('remove:owner/2'), false); assert.deepEqual([...f.objects].sort(), ['2','3']);
});


test('short multi-pick preserves later staged replacements exactly', async () => {
  const f = editor(); await f.focus();
  try {
    await f.pick(['A','B','C'].map(photo));
    const second = f.draft().photos[2], third = f.draft().photos[3];
    await f.pick([photo('X')]);
    assert.equal(f.draft().photos[2], second); assert.equal(f.draft().photos[3], third);
    await f.pick([photo('Y'), photo('Z')]); assert.equal(f.draft().photos[3], third);
  } finally { f.blur(); }
});

for (const slot of positions) test('empty Add in slot ' + slot + ' opens ordered multi-select', async () => {
  const f = editor([]); await f.focus();
  try {
    await f.pick(['X','Y','Z'].map(photo), slot);
    assert.deepEqual(f.calls[0], { mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 3, orderedSelection: true, allowsEditing: false, quality: 1 });
    assert.deepEqual(f.draft().photos, { 1: replace('X'), 2: replace('Y'), 3: replace('Z') });
    const text = f.render().filter(n => n.type === 'Text').map(n => n.props.children);
    assert.ok(!text.some(value => [1,2,3,'1 Primary','2','3'].includes(value)));
    assert.ok(!text.some(value => typeof value === 'string' && value.includes('Check the order')));
  } finally { f.blur(); }
});


for (const [remote, tapped, targets] of [ [[1],2,[2,3]], [[1,2],3,[3]], [[],1,[1,2,3]], [[1,3],2,[2]], [[2],3,[1,3]] ]) {
  test('empty Add fills canonical empty positions ' + targets.join(','), async () => {
    const f = editor(remote); await f.focus();
    try {
      await f.pick(targets.map(p => photo('new' + p)), tapped);
      assert.equal(f.calls[0].selectionLimit, targets.length);
      assert.equal(f.calls[0].allowsMultipleSelection, true);
      for (const p of positions) assert.deepEqual(f.draft().photos[p], targets.includes(p) ? replace('new' + p) : undefined);
    } finally { f.blur(); }
  });
}

test('empty Add respects staged occupancy and rejects excess results without overwriting', async () => {
  const f = editor([1,3]); await f.focus();
  try {
    await f.pick([photo('staged')], 3); const third = f.draft().photos[3];
    const before = f.draft();
    await f.pick([photo('X'),photo('Y')], 2); assert.equal(f.draft(), before);
    await f.pick([photo('X')], 2); assert.deepEqual(f.draft().photos[2], replace('X')); assert.equal(f.draft().photos[3], third);
    f.remove(1); f.remove(3);
    await f.pick([photo('A'),photo('C')], 3);
    assert.equal(f.calls.at(-1).selectionLimit, 2);
    assert.deepEqual(f.draft().photos, {1: replace('A'),2: replace('X'),3: replace('C')});
  } finally { f.blur(); }
});
