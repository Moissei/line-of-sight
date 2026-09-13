const fs = require('node:fs');
const ts = require('typescript');
const { test } = require('node:test');
const assert = require('node:assert/strict');
function load(path, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const module = { exports: {} };
  new Function('require','module','exports',code)(id => {
    if (id in dependencies) return dependencies[id]; throw Error('Unexpected dependency');
  },module,module.exports); return module.exports;
}
function fixture({ fail = false, presenceFails = false, cleanupFails = false } = {}) {
  const calls = []; let release, hold = false;
  const client = {
    auth: {
      async getUser() { calls.push('user'); return { data: { user: { id: 'internal' } }, error: null }; },
      async signOut(options) { assert.deepEqual(options, { scope: 'local' }); calls.push('signout');
        if (hold) await new Promise(r => { release = r; }); return { error: fail ? {} : null }; },
    },
    from(table) { assert.equal(table,'active_discovery_sessions'); return {
      update(value) { assert.deepEqual(value,{ is_active: false }); return this; },
      eq(column,value) { assert.equal(column,'user_id'); assert.equal(value,'internal'); return this; },
      async abortSignal() { calls.push('stop'); if (presenceFails) throw Error('private'); return { error: null }; },
    }; },
    async removeAllChannels() { calls.push('cleanup'); if (cleanupFails) throw Error('private'); },
  };
  const helper = load('src/lib/logout.ts', { './supabase': { supabase: client }, './push-notifications': { async unregisterPushForLogout(){ throw Error('private'); } } });
  const locks = load('src/lib/safety-actions.ts', {});
  let i=0, tree; const values=[];
  const react={ useState(initial) { const n=i++; if (!(n in values)) values[n]=initial; return [values[n],v=> { values[n]=v; }]; },
    useRef(initial) { const n=i++; return values[n] ?? (values[n]={current:initial}); } };
  const native=Object.fromEntries(['Modal','Pressable','Text','View','ScrollView'].map(x=>[x,x]));native.StyleSheet={create:x=>x};
  const jsx=(type,props)=>({type,props});
  const {default:Screen}=load('src/app/account.tsx', { react, 'react/jsx-runtime': { jsx,jsxs:jsx },
    'expo-symbols': {SymbolView:'SymbolView'}, 'expo-router': {useRouter:()=>({back(){}})}, 'react-native':native,
    'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'}, '@/lib/logout':helper, '@/lib/safety-actions':locks,
    '@/lib/delete-account': {} });
  function render(){ i=0;tree=Screen(); }
  function nodes(x){ if (!x || typeof x!=='object') return []; if(Array.isArray(x))return x.flatMap(nodes);
    if(x.type==='Modal'&&!x.props.visible)return []; return [x,...nodes(x.props?.children)]; }
  function text(x){if(typeof x==='string')return x;if(Array.isArray(x))return x.map(text).join('');return x?.props?text(x.props.children):'';}
  function tap(label){render();const button=nodes(tree).filter(x=>x.type==='Pressable'&&text(x)===label).at(-1);assert.ok(button);if(!button.props.disabled)button.props.onPress();render();}
  render();return {helper,calls,tap, text:()=>nodes(tree).filter(x=>x.type==='Text').map(text).join(' '),
    async settle(){await new Promise(r=>setImmediate(r));render();},hold(){hold=true;},release(){release();} };
}
test('confirmation and cancel do not log out; double taps send once',async()=>{
  const f=fixture();f.tap('Log Out');assert.equal(f.calls.length,0);assert.match(f.text(),/Log out\?/);
  f.tap('Cancel');assert.equal(f.calls.length,0);f.tap('Log Out');f.hold();f.tap('Log Out');f.tap('Logging out...');
  await f.settle();assert.deepEqual(f.calls,['user','stop','signout']);f.release();await f.settle();assert.equal(f.calls.filter(x=>x==='signout').length,1);assert.equal(f.calls.at(-1),'cleanup');
});
test('failure restores confirmation controls with generic error',async()=>{
  const f=fixture({fail:true});f.tap('Log Out');f.tap('Log Out');await f.settle();assert.match(f.text(),/Please try again/);
  assert.equal(f.text().includes('private'),false);assert.equal(f.calls.includes('cleanup'),false);
  f.tap('Log Out');await f.settle();assert.equal(f.calls.filter(x=>x==='signout').length,2);
});
test('presence and channel cleanup failures do not prevent successful logout',async()=>{
  const f=fixture({presenceFails:true,cleanupFails:true});await f.helper.logOut();assert.deepEqual(f.calls,['user','stop','signout','cleanup']);
});
test('auth change resets local provider/navigation and protects every authenticated route',()=>{
  const source=fs.readFileSync('src/app/_layout.tsx','utf8');
  assert.match(source,/event === 'SIGNED_OUT'/);assert.match(source,/<OnboardingProvider key=\{auth.generation\}>/);
  const protectedBlock=source.split('<Stack.Protected guard={signedIn}>')[1];
  for(const route of ['(tabs)','account','connection-detail','create-profile','intentions']) assert.ok(protectedBlock.includes(`name="${route}"`));
  assert.match(source,/generation: current.generation \+ \(reset \? 1 : 0\)/);
  const discovery=fs.readFileSync('src/app/(tabs)/discovery.tsx','utf8');assert.match(discovery,/stopPolling.current\?\.\(\)/);assert.match(discovery,/setNearby\(null\)/);
  const realtime=fs.readFileSync('src/lib/message-realtime.ts','utf8');assert.match(realtime,/if \(stopped\) return/);assert.match(realtime,/controller|abort.abort\(\)/);
});
test('SIGNED_OUT changes the real layout guard and remount key; token refresh preserves state', async () => {
  let callback, deletionCallback, tree, index=0; const state=[], effects=[];
  global.__DEV__=false;
  const react={ useState(initial){ const n=index++;if(!(n in state))state[n]=initial;return[state[n],v=>{state[n]=typeof v==='function'?v(state[n]):v;}];},useEffect(fn){effects.push(fn);} };
  const jsx=(type,props,key)=>({type,props,key});
  const Stack=Object.assign(()=>{}, {Screen:'Screen',Protected:'Protected'});
  const {default:Layout}=load('src/app/_layout.tsx', {
    react,'react/jsx-runtime':{jsx,jsxs:jsx},'expo-font':{useFonts:()=>[true,null]},
    'expo-router':{DarkTheme:{},DefaultTheme:{},Stack,ThemeProvider:'Theme'},
    'expo-splash-screen':{preventAutoHideAsync(){},hideAsync(){}},'react-native':{useColorScheme:()=>null},
    '@/components/profile-status-provider':{ProfileStatusProvider:'StatusProvider',useProfileStatus:()=>({status:'complete'})},
    '@/components/onboarding-provider':{OnboardingProvider:'Provider'},'@/assets/fonts/Tangerine-Bold.ttf':1,
    '@/lib/delete-account': { isAccountDeleted:()=>false, resetDeletedAccount(){}, onAccountDeleted(fn){deletionCallback=fn;return()=>{};} },
    '@/lib/use-push-notifications': { usePushNotifications(){} },
    '@/lib/supabase':{supabase:{auth:{onAuthStateChange(fn){callback=fn;return{data:{subscription:{unsubscribe(){}}}};}},async removeAllChannels(){}}},
  });
  function render(){index=0;tree=Layout();}
  render();effects.splice(0).forEach(fn=>fn());callback('INITIAL_SESSION',{user:{id:'internal'}});render();
  const provider=()=>tree.props.children;
  const guard=()=>provider().props.children.props.children.props.signedIn;
  assert.equal(guard(),true);const key=provider().key;
  callback('TOKEN_REFRESHED',{user:{id:'internal'}});render();assert.equal(provider().key,key);
  callback('SIGNED_OUT',null);render();assert.equal(guard(),false);assert.notEqual(provider().key,key);
  callback('SIGNED_IN',{user:{id:'internal'}});render();assert.equal(guard(),true);
  const beforeDeletion=provider().key;deletionCallback();render();assert.equal(guard(),false);assert.notEqual(provider().key,beforeDeletion);
  await new Promise(r=>setTimeout(r,5));delete global.__DEV__;
});
