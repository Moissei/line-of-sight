const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync('src/app/(tabs)/profile.tsx', 'utf8');
test('age accounts for birthday without presenting date of birth', () => {
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', code)(name => name === 'react-native' ? { StyleSheet: { create: x => x } } : {}, module, module.exports);
  assert.equal(module.exports.profileAge('2000-09-14', new Date(2026, 8, 13)), 25);
  assert.equal(module.exports.profileAge('2000-09-13', new Date(2026, 8, 13)), 26);
});
test('presentation reuses read-only previews and existing edit route without editing controls', () => {
  assert.match(source, /ownPhotoPreviews\(owner/);
  assert.match(source, /useFocusEffect/);
  assert.match(source, /router.push\('\/edit-profile'\)/);
  assert.match(source, /router.push\('\/account'\)/);
  assert.match(source, /Add a glimpse of yourself/);
  assert.doesNotMatch(source, /TextInput|reconcilePhotos|saveProfile|\.upsert\(|\.update\(|\.delete\(/);
  assert.match(fs.readFileSync('src/app/edit-profile.tsx', 'utf8'), /<ProfileForm editing \/>/);
  const root = fs.readFileSync('src/app/_layout.tsx', 'utf8');
  assert.match(root, /<Stack.Protected guard=\{complete\}>\s*<Stack.Screen name="\(tabs\)" \/><Stack.Screen name="edit-profile" \/>/);
});

test('carousel keeps stable slot keys and native snapping for one/two/three photos with pagination dots', () => {
  for (const photos of [{}, { 1: 'one' }, { 1: 'one', 2: 'two' }, { 3: 'three', 1: 'one', 2: 'two' }]) {
    const state = []; let cursor = 0;
    const module = { exports: {} };
    const jsx = (type, props, key) => ({ type, props, key });
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
    new Function('require', 'module', 'exports', code)(name => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return { useState(v) { const i = cursor++; if (!(i in state)) state[i] = typeof v === 'function' ? v() : v; return [state[i], x => { state[i] = x; }]; }, useEffect: () => {}, useRef: v => ({ current: v }) };
      if (name === 'react-native') return { View: 'View', Image: 'Image', ScrollView: 'ScrollView', StyleSheet: { create: x => x }, PanResponder: { create: handlers => ({ panHandlers: handlers }) }, Animated: { ScrollView: 'AnimatedScrollView', event: (_, config) => config.listener, View: 'AnimatedView', Value: class { stopAnimation() {} setValue() {} interpolate(config) { return config; } }, timing: () => ({ start: fn => fn({finished:true}) }) } };
      if (name.endsWith('profile-photo-image')) return { ProfilePhotoImage: 'PreparedImage' };
      if (name.endsWith('profile-photos')) return { PHOTO_POSITIONS: [1, 2, 3] };
      return {};
    }, module, module.exports);
    function render() {
      cursor = 0; const nodes = [];
      function walk(n) { if (Array.isArray(n)) return n.forEach(walk); if (!n || typeof n !== 'object') return; nodes.push(n); walk(n.props?.children); }
      walk(module.exports.ProfilePhotoPager({ photos, onFailure() {} })); return nodes;
    }
    render().find(n => n.props?.onLayout).props.onLayout({ nativeEvent: { layout: { width: 260 } } });
    let nodes = render();
    assert.deepEqual(nodes.filter(n => n.type === 'PreparedImage').map(n => n.props.uri), Object.keys(photos).map(k => photos[k]));
    const count = Object.keys(photos).length;
    assert.equal(nodes.filter(n => n.type === 'AnimatedView').length, count);
    assert.equal(nodes.filter(n => n.props?.style === undefined ? false : Array.isArray(n.props.style) && n.props.style[0]?.width === 5).length, count > 1 ? count : 0);
    assert.doesNotMatch(source, /zIndex|translateX|scale:/);
    assert.doesNotMatch(source, /ProfilePhotoPager key=/);
    assert.deepEqual(nodes.filter(n => n.type === 'AnimatedView').map(n => Number(n.key)), Object.keys(photos).map(Number));
    const pager = nodes.find(n => n.type === 'AnimatedScrollView');
    if (count) {
      assert.equal(pager.props.horizontal, true);
      assert.equal(pager.props.scrollEnabled, count > 1);
      assert.equal(pager.props.snapToInterval, 278);
      assert.equal(pager.props.contentContainerStyle.gap, 18);
      if (count > 1) {
        pager.props.onScroll({ nativeEvent: { contentOffset: { x: 278 } } });
        nodes = render(); assert.ok(nodes.some(n => n.props?.accessibilityLabel === `Photo 2 of ${count}`));
      }
    }
    assert.doesNotMatch(source, /PanResponder|positions\.(sort|reverse|splice)/);
    assert.match(source, />Account<\/Text>/);
    assert.match(source, /Your presence on Line of Sight\./);
    assert.doesNotMatch(source, /gearshape|borderBottomColor/);


  }
});

test('details card contains identity and bio but excludes edit action', () => {
  const card = source.slice(source.indexOf('<View style={styles.detailsCard}>'), source.indexOf('<Pressable accessibilityRole="button" style={({ pressed }) => [styles.edit'));
  assert.match(card, /styles.identity/);
  assert.match(card, /styles.chips/);
  assert.match(card, /styles.glimpse/);
  assert.match(card, /<\/View>\s*<\/View>\s*$/);
  assert.match(source, /genderSymbol: \{ fontSize: 20/);
  assert.match(source, /styles.genderSymbol/);
  assert.ok(source.includes("profile.gender === 'Male' || profile.gender === 'Female'"));
});
