const fs = require('node:fs');
const ts = require('typescript');
const { test } = require('node:test');
const assert = require('node:assert/strict');

function load(path, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => {
    if (id in dependencies) return dependencies[id];
    throw Error('Unexpected dependency');
  }, module, module.exports);
  return module.exports;
}

function fixture(authError = null, mode = 'signup', platform = 'android') {
  let index = 0, tree, focused = false;
  const values = [], calls = [], routes = [];
  const react = {
    useState(initial) { const n = index++; if (!(n in values)) values[n] = initial; return [values[n], v => { values[n] = v; }]; },
    useRef(initial) { const n = index++; return values[n] ?? (values[n] = { current: initial }); },
    useCallback(fn) { return fn; },
  };
  const native = Object.fromEntries(['TextInput', 'Text', 'View', 'Pressable', 'ScrollView', 'KeyboardAvoidingView'].map(x => [x, x]));
  Object.assign(native, { useWindowDimensions: () => ({ height: 800 }), Platform: { OS: platform }, Keyboard: { dismiss() {} }, StyleSheet: { create: x => x } });
  const jsx = (type, props, key) => ({ type, props, key });
  const errors = load('src/lib/auth-errors.ts', {});
  const { AuthScreen } = load('src/components/auth-screen.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) }, 'expo-status-bar': { StatusBar: 'StatusBar' },
    'expo-router': { useRouter: () => ({ replace: route => routes.push(route) }), useFocusEffect(fn) { if (!focused) { focused = true; fn(); } } },
    '@/lib/auth-errors': errors,
    '@/lib/supabase': { supabase: { auth: { async signUp(input) { calls.push(input); return { data: { session: {} }, error: authError }; } } } },
  });
  function render() { index = 0; tree = AuthScreen({ mode }); }
  function nodes(x) { if (!x || typeof x !== 'object') return []; if (Array.isArray(x)) return x.flatMap(nodes); return [x, ...nodes(x.props?.children)]; }
  function input(label) { return nodes(tree).find(x => x.type === 'TextInput' && x.props.accessibilityLabel === label); }
  function type(label, value) { input(label).props.onChangeText(value); render(); }
  function submit() { nodes(tree).find(x => x.type === 'Pressable' && x.props.accessibilityState).props.onPress(); render(); }
  render();
  return { calls, routes, input, type, submit, nodes: () => nodes(tree), async settle() { await new Promise(r => setImmediate(r)); render(); },
    error: () => nodes(tree).find(x => x.props.accessibilityRole === 'alert')?.props.children };
}

test('login secondary action opens existing signup route; signup keeps its login action', () => {
  const f = fixture(null, 'login');
  const action = f.nodes().find(n => n.type === 'Pressable' && n.props.children?.props?.children === 'New to Line of Sight? Create account');
  assert.ok(action); action.props.onPress(); assert.deepEqual(f.routes, ['/sign-up']);
  const signup = fixture();
  assert.ok(!signup.nodes().some(n => n.props.children?.props?.children === 'New to Line of Sight? Create account'));
  assert.ok(signup.nodes().some(n => n.props.children?.props?.children === 'Already have an account? Log in'));
});

test('editing preserves every space and independent controlled password states', () => {
  const f = fixture();
  for (const label of ['Password', 'Confirm password']) {
    for (const value of [' ', ' a', ' a ', ' a  b ', '']) {
      const other = label === 'Password' ? 'Confirm password' : 'Password';
      const before = f.input(other).props.value;
      f.type(label, value);
      assert.equal(f.input(label).props.value, value);
      assert.equal(f.input(other).props.value, before);
      assert.equal(f.input(label).key, undefined);
    }
    assert.equal(f.input(label).props.secureTextEntry, true);
    assert.equal(f.input(label).props.autoCorrect, false);
    assert.equal(f.input(label).props.spellCheck, false);
    assert.equal(f.input(label).props.autoCapitalize, 'none');
  }
  assert.equal(f.input('Confirm password').props.autoComplete, 'off');
  assert.equal(f.input('Confirm password').props.importantForAutofill, 'no');
});

test('exact mismatch including trailing space prevents any signup attempt', async () => {
  const f = fixture(); f.type('Email', 'test@example.invalid'); f.type('Password', 'password '); f.type('Confirm password', 'password');
  f.submit(); f.submit(); await f.settle();
  assert.equal(f.calls.length, 0); assert.match(f.error(), /do not match/);
});

test('matching passwords reach mocked signup unchanged and duplicate submissions are locked', async () => {
  const f = fixture(); f.type('Email', ' test@example.invalid '); f.type('Password', ' pass word '); f.type('Confirm password', ' pass word ');
  f.submit(); f.submit(); await f.settle();
  assert.deepEqual(f.calls, [{ email: 'test@example.invalid', password: ' pass word ', options: { emailRedirectTo: 'lineofsight://auth-callback' } }]);
  assert.deepEqual(f.routes, ['/profile-gate']);
});

test('429 produces friendly copy and permits retry without exposing server text', async () => {
  const f = fixture({ status: 429, message: 'private backend error' });
  f.type('Email', 'test@example.invalid'); f.type('Password', 'password'); f.type('Confirm password', 'password');
  f.submit(); await f.settle(); assert.equal(f.error(), 'Too many attempts. Please try again shortly.');
  f.submit(); await f.settle(); assert.equal(f.calls.length, 2);
});

test('rate-limit codes and unknown errors never expose raw server messages', () => {
  const { authErrorMessage } = load('src/lib/auth-errors.ts', {});
  for (const code of ['over_request_rate_limit', 'over_email_send_rate_limit']) {
    assert.equal(authErrorMessage({ code }), 'Too many attempts. Please try again shortly.');
  }
  assert.equal(authErrorMessage({ status: 429, code: 'validation_failed' }), 'Too many attempts. Please try again shortly.');
  assert.doesNotMatch(authErrorMessage({ message: 'private backend error' }), /private/);
});

test('web signup keeps its existing redirect behavior', async () => {
  const f = fixture(null, 'signup', 'web');
  f.type('Email', 'test@example.invalid'); f.type('Password', 'password'); f.type('Confirm password', 'password');
  f.submit(); await f.settle();
  assert.deepEqual(f.calls, [{ email: 'test@example.invalid', password: 'password' }]);
});

test('callback shows safe copy, handles query/fragment errors, and only navigates to login', () => {
  for (const params of [{}, { access_token: 'sensitive' }, { error_description: 'sensitive' }, { '#': 'error=denied&access_token=sensitive' }]) {
    const routes = [];
    const jsx = (type, props) => ({ type, props });
    const { default: Screen } = load('src/app/auth-callback.tsx', {
      'react/jsx-runtime': { jsx, jsxs: jsx },
      'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({ replace: route => routes.push(route) }) },
      'react-native': { Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', StyleSheet: { create: x => x } },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    });
    const tree = Screen();
    assert.ok(!JSON.stringify(tree).includes('sensitive'));
    const children = tree.props.children.props.children;
    assert.equal(children[1].props.accessibilityRole === 'alert', 'error_description' in params || '#' in params);
    children[2].props.onPress(); assert.deepEqual(routes, ['/login']);
  }
  const layout = fs.readFileSync('src/app/_layout.tsx', 'utf8');
  assert.ok(layout.indexOf('name="auth-callback"') > layout.lastIndexOf('</Stack.Protected>'));
});
