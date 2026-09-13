const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const jsx = (type, props) => ({ type, props });
function load(path, mocks = {}, suffix = '') {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8') + suffix, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', 'queueMicrotask', code)(name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name in mocks) return mocks[name];
    throw Error('Unexpected dependency: ' + name);
  }, module, module.exports, fn => fn());
  return module.exports;
}
const { hasRequiredProfile } = load('src/lib/profile-status.ts');
const valid = { first_name: 'Test', date_of_birth: '1990-01-02', intents: [] };
test('completion uses required identity fields, not intentions or account lifecycle', () => {
  assert.equal(hasRequiredProfile(valid), true);
  for (const row of [null, {}, {state:'active'}, {...valid,first_name:' '}, {...valid,date_of_birth:null}, {...valid,date_of_birth:'2001-02-30'}, {...valid,date_of_birth:'2999-01-01'}]) assert.equal(hasRequiredProfile(row), false);
});
function fixture() {
  let slots=[], index=0, effects=[], pending=[], tree, draft={};
  const react={
    createContext:()=>({Provider:'Provider'}), useContext:()=>{},
    useState(initial){const n=index++;if(!(n in slots))slots[n]=initial;return [slots[n],value=>{slots[n]=typeof value==='function'?value(slots[n]):value;}];},
    useRef(initial){const n=index++;return slots[n]??(slots[n]={current:initial});},
    useCallback(fn,deps){const n=index++;if(!slots[n]||deps.some((v,i)=>v!==slots[n].deps[i]))slots[n]={fn,deps};return slots[n].fn;},
    useEffect(fn,deps){const n=index++;if(!slots[n]||deps.some((v,i)=>v!==slots[n].deps[i])){slots[n]?.cleanup?.();const item={deps};slots[n]=item;effects.push(()=>{item.cleanup=fn();});}},
  };
  const setDraft=fn=>{draft=fn(draft);};
  const supabase={from:()=>{const q={select:()=>q,eq:()=>q,abortSignal:signal=>{q.signal=signal;return q;},maybeSingle:()=>new Promise(resolve=>pending.push({resolve,signal:q.signal}))};return q;}};
  const {ProfileStatusProvider}=load('src/components/profile-status-provider.tsx',{react,'@/lib/supabase':{supabase},'@/lib/profile-status':{hasRequiredProfile},'@/lib/profile':{PROFILE_INTENTS:['Dating','Friendship','Networking','Socializing']},'@/components/onboarding-provider':{useOnboarding:()=>({setDraft})}});
  return {render(user='a'){index=0;tree=ProfileStatusProvider({userId:user,children:null});effects.splice(0).forEach(fn=>fn());return tree.props.value;},pending, draft:()=>draft};
}
test('missing row, restart, lookup error, and empty-intention completed account', async()=>{
  for(const [response,expected] of [[{data:null,error:null},'required'],[{data:valid,error:null},'complete'],[{data:null,error:{}},'error']]){
    const f=fixture();assert.equal(f.render().status,'loading');f.pending[0].resolve(response);await Promise.resolve();assert.equal(f.render().status,expected);
  }
});
test('account switching and logout suppress stale results; incomplete values hydrate safely',async()=>{
  const f=fixture();f.render('a');assert.equal(f.render('b').status,'loading');assert.equal(f.pending[0].signal.aborted,true);
  f.pending[0].resolve({data:valid,error:null});await Promise.resolve();assert.equal(f.render('b').status,'loading');
  f.pending[1].resolve({data:{...valid,date_of_birth:null,bio:'Keep me'},error:null});await Promise.resolve();assert.equal(f.render('b').status,'required');assert.equal(f.draft().bio,'Keep me');
  assert.equal(f.render(null).status,'loading');
});
test('recheck unlocks routes only after persisted profile is complete; failure remains closed',async()=>{
  const f=fixture();f.render();f.pending[0].resolve({data:null,error:null});await Promise.resolve();
  let check=f.render().refresh();assert.equal(f.render().status,'loading');f.pending[1].resolve({data:null,error:{}});await check;assert.equal(f.render().status,'error');
  check=f.render().refresh();f.pending[2].resolve({data:valid,error:null});await check;assert.equal(f.render().status,'complete');
});
test('actual route guards exclude tabs/chat for incomplete/loading/error users and gate notifications',()=>{
  let status='loading',pushEnabled;
  const Stack=Object.assign(()=>{}, {Screen:'Screen',Protected:'Protected'});
  const {AuthenticatedRoutes}=load('src/app/_layout.tsx',{
    react:{},'expo-router':{Stack},'expo-font':{},'expo-splash-screen':{preventAutoHideAsync(){}},'react-native':{},
    '@/lib/supabase':{},'@/components/onboarding-provider':{},'@/lib/delete-account':{},
    '@/components/profile-status-provider':{useProfileStatus:()=>({status})},'@/lib/use-push-notifications':{usePushNotifications(value){pushEnabled=value;}},
  },'\nexport { AuthenticatedRoutes };');
  function allowed(node){if(Array.isArray(node))return node.flatMap(allowed);if(!node)return[];if(node.type==='Protected'&&!node.props.guard)return[];return node.type==='Screen'?[node.props.name]:allowed(node.props.children);}
  for(status of ['loading','error','required','complete']){
    const names=allowed(AuthenticatedRoutes({signedIn:true,generation:0}));
    for(const name of ['(tabs)','connection-detail'])assert.equal(names.includes(name),status==='complete');
    assert.equal(names.includes('create-profile'),status==='required');assert.ok(names.includes('account'));assert.ok(names.includes('auth-callback'));assert.equal(pushEnabled,status==='complete');
  }
  assert.equal(allowed(AuthenticatedRoutes({signedIn:false,generation:0})).includes('(tabs)'),false);
});
test('onboarding preserves two-step save order and profile absence is not a network error',()=>{
  const form=fs.readFileSync('src/components/profile-form.tsx','utf8');assert.match(form,/if \(!editing\) \{ router.push\('\/intentions'\); return; \}/);
  const finish=fs.readFileSync('src/app/intentions.tsx','utf8');assert.ok(finish.indexOf('await saveProfile(draft)')<finish.indexOf('await refreshProfileStatus()'));assert.match(finish,/validateProfile\(draft\)/);
  const edit=fs.readFileSync('src/app/(tabs)/edit-profile.tsx','utf8');assert.match(edit,/maybeSingle\(\)/);assert.match(edit,/if \(!data\).*refreshProfileStatus/);
  const profile=fs.readFileSync('src/lib/profile.ts','utf8');assert.match(profile,/never used as discovery filters/);
});

test('actual FINISH PROFILE refreshes status only on save success, retains draft on failure',async()=>{
  for(const fail of [false,true]){
    const calls=[];const draft={...valid,firstName:'Test',dateOfBirth:'01/02/1990',intents:['Dating']};
    const react={useState:v=>[v,()=>{}],useRef:v=>({current:v}),useEffect:fn=>fn()};
    const {default:Screen}=load('src/app/intentions.tsx',{
      react,'expo-router':{useRouter:()=>({replace(){throw Error('Should route through guard');}})},'expo-status-bar':{StatusBar:'StatusBar'},'expo-symbols':{SymbolView:'SymbolView'},
      'react-native':{StyleSheet:{create:x=>x},...Object.fromEntries(['Pressable','ScrollView','Text','View'].map(x=>[x,x]))},'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},
      '@/components/onboarding-provider':{useOnboarding:()=>({draft,setDraft(){calls.push('clear');}})},
      '@/components/profile-status-provider':{useProfileStatus:()=>({refresh:async()=>calls.push('refresh')})},
      '@/lib/profile':{PROFILE_INTENTS:['Dating','Friendship','Networking','Socializing'],emptyProfileDraft:{},validateProfile:()=>null,profileSaveError:()=> 'Could not save',saveProfile:async()=>{calls.push('save');if(fail)throw Error('mock failure');}},
    });
    const nodes=[];function walk(n){if(Array.isArray(n))return n.forEach(walk);if(!n||typeof n!=='object')return;nodes.push(n);walk(n.props.children);}walk(Screen());
    nodes.find(n=>n.type==='Pressable'&&n.props.children?.props?.children==='FINISH PROFILE').props.onPress();
    await new Promise(r=>setImmediate(r));assert.deepEqual(calls,fail?['save']:['save','clear','refresh']);
  }
});
