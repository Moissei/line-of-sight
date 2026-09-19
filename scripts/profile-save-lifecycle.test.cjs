const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function fixture() {
  let cursor = 0, calls = 0, resolve, reject;
  const states = [], events = [];
  const jsx = (type, props) => ({ type, props });
  const module = { exports: {} };
  const mocks = {
    react: { useContext: () => 0, useState(value) { const i = cursor++; if (!(i in states)) states[i] = value; return [states[i], v => { events.push(['state', i, v]); states[i] = v; }]; }, useRef(value) { const i = cursor++; return states[i] ??= { current: value }; } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'expo-router': { useRouter: () => ({ canGoBack: () => true, back: () => events.push(['back']) }) },
    'expo-router/js-tabs': {}, 'expo-status-bar': {}, 'expo-symbols': {}, 'react-native-safe-area-context': {},
    'react-native': { StyleSheet: { create: x => x }, Platform: { OS: 'android' }, Keyboard: { dismiss() {} }, Pressable: 'Pressable' },
    '@/components/onboarding-provider': { useOnboarding: () => ({ draft: { firstName: 'Name', dateOfBirth: '01/01/2000', gender: 'Male', bio: '', intents: [] }, setDraft() { events.push(['draft']); } }) },
    '@/components/profile-photo-slots': { ProfilePhotoSlots: 'Photos' },
    '@/lib/profile': { PROFILE_INTENTS: [], validateProfile: () => null, profileSaveError: () => 'Please try again.', saveProfile() { calls++; return new Promise((a,b) => { resolve=a; reject=b; }); } },
  };
  const code = ts.transpileModule(fs.readFileSync('src/components/profile-form.tsx','utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require','module','exports',code)(name => mocks[name],module,module.exports);
  function render() { cursor=0;const nodes=[];function walk(n) { if(Array.isArray(n)) return n.forEach(walk);if(!n||typeof n!=='object')return;nodes.push(n);walk(n.props?.children); } walk(module.exports.ProfileForm({editing:true}));return nodes; }
  render().find(n=>n.type==='Photos').props.onBusy(false);
  const submit=()=>render().find(n=>n.type==='Pressable' && n.props.children?.props?.children === 'SAVE CHANGES')?.props.onPress;
  return { events, states, calls:()=>calls, submit, resolve:()=>resolve(), reject:()=>reject(new Error('private')), render };
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('success navigates once and performs no state mutations afterward; duplicate submit stays locked',async()=>{
  const f=fixture();const press=f.submit();press();press();assert.equal(f.calls(),1);
  f.resolve();await settle();assert.equal(f.events.filter(e=>e[0]==='back').length,1);
  assert.equal(f.events.at(-1)[0],'back');assert.equal(f.states[2],true);
  const count=f.events.length;press();await settle();assert.equal(f.calls(),1);assert.equal(f.events.length,count);
});
test('failure restores controls without navigation and permits retry',async()=>{
  const f=fixture();f.submit()();f.reject();await settle();
  assert.equal(f.states[2],false);assert.equal(f.states[0],'Please try again.');assert.equal(f.events.some(e=>e[0]==='back'),false);
  f.submit()();assert.equal(f.calls(),2);f.resolve();await settle();assert.equal(f.events.at(-1)[0],'back');
});
