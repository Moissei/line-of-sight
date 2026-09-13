const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

test('authenticated layout renders exactly four lazy tabs with existing paths and themed icons', () => {
  const source = fs.readFileSync('src/app/(tabs)/_layout.tsx', 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  const Tabs = Object.assign(() => {}, { Screen: () => {} });
  const jsx = (type, props) => ({ type, props });
  const mockRequire = name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'expo-router') return { Tabs };
    if (name === 'expo-symbols') return { SymbolView: 'SymbolView' };
    throw new Error('Unexpected dependency');
  };
  new Function('require', 'module', 'exports', code)(mockRequire, module, module.exports);
  const tree = module.exports.default();
  assert.equal(tree.type, Tabs);
  assert.equal(tree.props.initialRouteName, 'discovery');
  assert.equal(tree.props.screenOptions.lazy, true);
  assert.equal(tree.props.screenOptions.tabBarHideOnKeyboard, true);
  assert.deepEqual(tree.props.children.map(child => child.props.name), ['discovery', 'connections', 'requests', 'edit-profile']);
  assert.deepEqual(tree.props.children.map(child => child.props.options.title), ['Discovery', 'Connections', 'Requests', 'Profile']);
  for (const child of tree.props.children) {
    assert.ok(fs.existsSync(`src/app/(tabs)/${child.props.name}.tsx`));
    assert.equal(fs.existsSync(`src/app/${child.props.name}.tsx`), false);
    const icon = child.props.options.tabBarIcon({ color: '#253D2F' });
    assert.equal(icon.props.tintColor, '#253D2F');
    assert.ok(icon.props.name.ios && icon.props.name.android && icon.props.name.web);
  }
});

test('public routes stay outside protection; tabs and secondary screens remain protected', () => {
  const source = fs.readFileSync('src/app/_layout.tsx', 'utf8');
  const publicPart = source; const protectedPart = source.split('<Stack.Protected guard={signedIn}>')[1];
  for (const name of ['index', 'login', 'sign-up', 'auth-callback']) assert.ok(publicPart.includes(`name="${name}"`));
  for (const name of ['(tabs)', 'account', 'connection-detail', 'create-profile', 'intentions']) assert.ok(protectedPart.includes(`name="${name}"`));
});

test('tab safe areas exclude bottom; Profile opens existing Account and saves back to Discovery', () => {
  for (const name of ['discovery', 'connections', 'requests', 'edit-profile']) {
    const source = fs.readFileSync(`src/app/(tabs)/${name}.tsx`, 'utf8');
    assert.match(source, /edges=\{\['top', 'left', 'right'\]\}/);
  }
  const discovery = fs.readFileSync('src/app/(tabs)/discovery.tsx', 'utf8');
  assert.equal(discovery.includes('topControls'), false);
  const profile = fs.readFileSync('src/components/profile-form.tsx', 'utf8');
  assert.match(profile, /onPress=\{\(\) => router.push\('\/account'\)\}/);
  assert.match(profile, /if \(tabScreen\) router.navigate\('\/discovery'\)/);
  assert.match(fs.readFileSync('src/app/(tabs)/edit-profile.tsx', 'utf8'), /<ProfileForm editing tabScreen \/>/);
});
