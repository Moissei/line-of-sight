const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function fixture(previous, logout = async () => {}) {
  const state = []; let cursor = 0, calls = 0, backs = 0;
  const jsx = (type, props) => ({ type, props });
  const module = { exports: {} };
  const mocks = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    react: {
      useState(value) { const i = cursor++; if (!(i in state)) state[i] = value; return [state[i], v => { state[i] = v; }]; },
      useRef(value) { const i = cursor++; return state[i] ??= { current: value }; },
    },
    'expo-router': {
      useRootNavigationState: () => ({ index: previous ? 1 : 0, routes: [...(previous ? [{ name: previous }] : []), { name: 'create-profile' }] }),
      useRouter: () => ({ canGoBack: () => !!previous, back: () => { backs++; } }),
    },
    'react-native': { ...Object.fromEntries(['Modal', 'Pressable', 'ScrollView', 'Text', 'View'].map(x => [x, x])), StyleSheet: { create: x => x } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/components/profile-form': { ProfileForm: 'ProfileForm' },
    '@/lib/logout': { LOGOUT_ERROR: 'Please try again.', logOut: () => { calls++; return logout(); } },
  };
  const code = ts.transpileModule(fs.readFileSync('src/app/create-profile.tsx', 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', code)(name => { assert.ok(mocks[name], name); return mocks[name]; }, module, module.exports);
  function render() {
    cursor = 0; const nodes = [];
    function walk(n) { if (Array.isArray(n)) return n.forEach(walk); if (!n || typeof n !== 'object') return; nodes.push(n); walk(n.props?.children); walk(n.props?.topAction); }
    walk(module.exports.default()); return nodes;
  }
  return { render, calls: () => calls, backs: () => backs };
}
const action = (nodes, label) => nodes.find(n => n.type === 'Pressable' && (n.props.accessibilityLabel === label || n.props.children?.props?.children === label));

test('root, gate, public and tab history offer logout, never onboarding bypass', () => {
  for (const previous of [undefined, 'profile-gate', 'login', 'index', '(tabs)', 'connection-detail']) {
    const f = fixture(previous); action(f.render(), 'Log out').props.onPress();
    assert.equal(f.render().find(n => n.type === 'Modal').props.visible, true);
    assert.equal(f.calls(), 0); assert.equal(f.backs(), 0);
    action(f.render(), 'Cancel').props.onPress();
    assert.equal(f.render().find(n => n.type === 'Modal').props.visible, false);
    assert.equal(f.calls(), 0);
  }
});
test('legitimate previous onboarding/account route retains Back', () => {
  for (const previous of ['intentions', 'account']) {
    const f = fixture(previous); action(f.render(), 'Back').props.onPress();
    assert.equal(f.backs(), 1); assert.equal(f.calls(), 0);
  }
});
test('confirmed logout calls existing helper once, including duplicate taps', async () => {
  const f = fixture(); action(f.render(), 'Log out').props.onPress();
  const submit = action(f.render(), 'Log Out'); submit.props.onPress(); submit.props.onPress();
  await Promise.resolve();
  assert.equal(f.calls(), 1); assert.equal(f.backs(), 0);
  assert.equal(action(f.render(), 'Logging out...').props.disabled, true);
});
test('logout failure shows generic recovery and allows retry', async () => {
  const f = fixture(undefined, async () => { throw new Error('private backend detail'); });
  action(f.render(), 'Log out').props.onPress(); action(f.render(), 'Log Out').props.onPress();
  await Promise.resolve(); await Promise.resolve();
  const nodes = f.render();
  assert.equal(nodes.find(n => n.props?.accessibilityRole === 'alert').props.children, 'Please try again.');
  assert.equal(action(nodes, 'Log Out').props.disabled, false);
  action(nodes, 'Log Out').props.onPress(); assert.equal(f.calls(), 2);
});
