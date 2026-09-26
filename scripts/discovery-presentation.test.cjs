const fs = require('node:fs');
const ts = require('typescript');
const test = require('node:test');
const assert = require('node:assert/strict');
const jsx = (type, props) => ({ type, props });
const native = { StyleSheet: { create: x => x }, useWindowDimensions: () => ({ width: 400, height: 800 }) };
for (const name of ['View', 'Text', 'Pressable', 'ScrollView']) native[name] = name;
function load(file, deps) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(id => deps[id] ?? {}, exports);
  return exports;
}
function nodes(node) { return !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)]; }
for (const scenario of ['inactive', 'pending', 'unverified', 'empty', 'error', 'real']) {
  test('Discovery real-data presentation: ' + scenario, () => {
    const real = { user_id: 'real-fixture', first_name: 'Real', age: null, gender: null, bio: null, intents: [] };
    const values = [scenario !== 'inactive', scenario === 'pending', scenario === 'pending', '', scenario !== 'unverified', scenario === 'error' ? { status: 'error' } : { status: 'ready', profiles: scenario === 'real' ? [real] : [] }];
    const screen = load('src/app/(tabs)/discovery.tsx', {
      react: { useState: () => [values.shift(), () => {}], useRef: () => ({ current: true }), useCallback: fn => fn },
      'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
      'expo-router': { useFocusEffect() {} },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
      '@/components/nearby-profile-card': { NearbyProfileCard: 'Card', NearbySafetyOptions: 'SafetyFooter' },
    });
    const tree = screen.default();
    const cardNodes = nodes(tree).filter(n => n.type === 'Card');
    for (const card of cardNodes) card.props.children = card.props.sessionAction;
    const cards = nodes(tree).filter(n => n.type === 'Card');
    const displayed = scenario === 'real';
    const labels = nodes(tree).filter(n => n.type === 'Text').map(n => n.props.children).flat().filter(x => typeof x === 'string');
    assert.equal(labels.includes('Someone is in your line of sight'), displayed);
    if (displayed) {
      const ordered = nodes(tree);
      assert.ok(ordered.findIndex(n => n.type === 'SafetyFooter') > ordered.findIndex(n => n.type === 'Pressable'));
      const footer = ordered.filter(n => n.type === 'SafetyFooter');
      assert.equal(footer.length, 1);
      assert.equal(footer[0].props.userId, 'real-fixture');
      assert.equal(labels.includes('Looking nearby'), false);
      assert.equal(labels.includes("You're visible to others who are looking too."), true);
      assert.ok(labels.indexOf("You're visible to others who are looking too.") < labels.indexOf("Someone is in your line of sight"));
      const stop = nodes(tree).find(n => n.type === 'Pressable');
      const style = Object.assign({}, ...stop.props.style({ pressed: false }).filter(Boolean));
      assert.equal(style.borderWidth, 1); assert.equal(style.backgroundColor, 'transparent');
      assert.ok(style.minHeight >= 44); assert.equal(typeof stop.props.onPress, 'function');
    } else if (scenario === 'empty') assert.ok(labels.includes('Looking nearby'));
    assert.equal(cards.length, displayed ? 1 : 0);
    if (scenario === 'real') assert.deepEqual(cards.map(n => n.props.profile), [real]);
  });
}
