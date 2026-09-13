const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function fixture(gender) {
  let draft = { firstName: '', dateOfBirth: '', gender, bio: '', intents: [] };
  const jsx = (type, props) => ({ type, props });
  const module = { exports: {} };
  const requireMock = name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react') return { useContext: () => 80, useState: value => [value, () => {}], useRef: value => ({ current: value }) };
    if (name === 'expo-router/js-tabs') return { BottomTabBarHeightContext: {} };
    if (name === 'expo-router') return { useRouter: () => ({}) };
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name === 'expo-symbols') return { SymbolView: 'SymbolView' };
    if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (name === 'react-native') return { Platform: { OS: 'android' }, StyleSheet: { create: x => x }, ...Object.fromEntries(['View', 'Text', 'TextInput', 'Pressable', 'ScrollView', 'KeyboardAvoidingView'].map(x => [x, x])) };
    if (name.endsWith('onboarding-provider')) return { useOnboarding: () => ({ draft, setDraft: fn => { draft = fn(draft); } }) };
    if (name.endsWith('profile-photo-slots')) return { ProfilePhotoSlots: 'Photos' };
    if (name.endsWith('/profile')) return { PROFILE_INTENTS: ['Dating', 'Friendship', 'Networking', 'Socializing'] };
    throw new Error('Unexpected import');
  };
  const code = ts.transpileModule(fs.readFileSync('src/components/profile-form.tsx', 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', code)(requireMock, module, module.exports);
  function render(editing = true, tabScreen = false) {
    const nodes = [];
    function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; nodes.push(node); walk(node.props?.children); }
    walk(module.exports.ProfileForm({ editing, tabScreen }));
    return nodes;
  }
  return { render, draft: () => draft };
}

test('editing gender has exactly two choices, preserves existing/legacy values until selection', () => {
  for (const gender of ['Male', 'Female', 'Legacy value', '']) {
    const f = fixture(gender);
    const nodes = f.render();
    const choices = nodes.filter(n => n.props?.accessibilityRole === 'radio');
    assert.deepEqual(choices.map(n => n.props.accessibilityLabel), ['Male', 'Female']);
    assert.equal(nodes.some(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'Gender'), false);
    assert.equal(f.draft().gender, gender);
    for (const choice of choices) assert.equal(choice.props.accessibilityState.checked, choice.props.accessibilityLabel === gender);
    choices[1].props.onPress(); assert.equal(f.draft().gender, 'Female');
  }
  assert.deepEqual(fixture('').render(false).filter(n => n.props?.accessibilityRole === 'radio').map(n => n.props.accessibilityLabel), ['Male', 'Female']);
});

test('intent choices retain exact labels and multi-selection toggling', () => {
  const f = fixture('Male');
  const choices = () => f.render().filter(n => n.props?.accessibilityRole === 'checkbox');
  assert.deepEqual(choices().map(n => n.props.children[0].props.children), ['Dating', 'Friendship', 'Networking', 'Socializing']);
  choices()[0].props.onPress(); choices()[1].props.onPress();
  assert.deepEqual(f.draft().intents, ['Dating', 'Friendship']);
  assert.equal(choices()[0].props.accessibilityState.checked, true);
  choices()[0].props.onPress(); assert.deepEqual(f.draft().intents, ['Friendship']);
});

 test('Profile scroll clearance includes measured tab height once and bio label preserves its input', () => {
  const f = fixture('Male');
  const nodes = f.render(true, true);
  const scroll = nodes.find(n => n.type === 'ScrollView');
  assert.equal(scroll.props.contentContainerStyle[1].paddingBottom, 104);
  assert.equal(scroll.props.keyboardShouldPersistTaps, 'handled');
  const bio = nodes.find(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'A glimpse');
  assert.equal(bio.props.maxLength, 200);
  assert.equal(bio.props.placeholder, 'Share a little about yourself…');
  assert.equal(bio.props.underlineColorAndroid, 'transparent');
  const name = nodes.find(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'Name');
  name.props.onChangeText('Test name');
  assert.equal(f.draft().firstName, 'Test name');
  bio.props.onChangeText('Existing bio stays in the same field');
  assert.equal(f.draft().bio, 'Existing bio stays in the same field');
  const onboarding = f.render(false);
  assert.equal(onboarding.find(n => n.type === 'ScrollView').props.contentContainerStyle[1], false);
  assert.ok(onboarding.some(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'A glimpse'));
 });
