const fs = require('node:fs');
const ts = require('typescript');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
function load(path, deps) {
  const code=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',code)(id=>{if(id in deps)return deps[id];throw Error('Unexpected dependency');},module,module.exports);
  return module.exports;
}

test('installed Supabase SDK sends a bodyless POST with session authorization and no query', async () => {
  const token = 'mock-session-access-token';
  let captured;
  const client = createClient('https://example.invalid', 'mock-publishable-key', {
    accessToken: async () => token,
    global: { fetch: async (url, init) => {
      captured = { url: String(url), init };
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
    } },
  });
  const { error } = await client.functions.invoke('delete-account', { method: 'POST' });
  assert.equal(error, null);
  assert.equal(captured.url, 'https://example.invalid/functions/v1/delete-account');
  assert.equal(new URL(captured.url).search, '');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.body, undefined);
  const headers = new Headers(captured.init.headers);
  assert.equal(headers.get('Authorization'), `Bearer ${token}`);
  assert.equal(headers.get('apikey'), 'mock-publishable-key');
  assert.equal(headers.has('Content-Type'), false);
  assert.doesNotMatch(JSON.stringify(captured), /user_id|target_user_id|userId/);
});

test('handler accepts null and zero-byte bodies, rejects all payload bytes and queries', async () => {
  const { createDeleteAccountHandler } = load('supabase/functions/delete-account/handler.ts', {});
  const handler = createDeleteAccountHandler({}, []);
  const url = 'https://example.invalid/functions/v1/delete-account';
  assert.equal((await handler(new Request(url, { method: 'POST' }))).status, 401);
  assert.equal((await handler(new Request(url + '?unexpected=1', { method: 'POST' }))).status, 400);
  // A transport can represent zero bytes as a non-null body stream.
  const request = new Request(url, { method: 'POST', body: '' });
  assert.equal(await request.clone().text(), '');
  assert.notEqual(request.body, null);
  assert.equal((await handler(request)).status, 401);
  for (const body of ['x', '{}', ' \n\t', '{"target_user_id":"untrusted"}']) {
    const result = await handler(new Request(url, { method: 'POST', body }));
    assert.equal(result.status, 400);
    assert.deepEqual(await result.json(), { error: 'Could not complete this request. Please try again.' });
  }
});
function fixture() {
  const calls=[];let fail=false, hold=false, release;
  const client={functions:{async invoke(name,options){calls.push('invoke');assert.equal(name,'delete-account');assert.deepEqual(options,{method:'POST'});if(hold)await new Promise(r=>release=r);return fail?{error:{message:'private-secret'}}:{data:{success:true},error:null};}},
    auth:{async signOut(options){assert.deepEqual(options,{scope:'local'});calls.push('signout');}},async removeAllChannels(){calls.push('channels');}};
  const helper=load('src/lib/delete-account.ts',{'./supabase':{supabase:client}});
  helper.onAccountDeleted(()=>calls.push('reset'));
  let index=0,tree;const state=[];
  const react={useState(value){const n=index++;if(!(n in state))state[n]=value;return[state[n],v=>state[n]=v];},useRef(value){const n=index++;return state[n]??(state[n]={current:value});}};
  const jsx=(type,props)=>({type,props});
  const native=Object.fromEntries(['Modal','Pressable','Text','View','ScrollView'].map(x=>[x,x]));native.StyleSheet={create:x=>x};
  const {default:Screen}=load('src/app/account.tsx',{react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':native,'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'expo-symbols':{SymbolView:'SymbolView'},'expo-router':{useRouter:()=>({back(){}})},'@/lib/logout':{},'@/lib/safety-actions':load('src/lib/safety-actions.ts',{}),'@/lib/delete-account':helper});
  function render(){index=0;tree=Screen();}
  function nodes(x){if(!x||typeof x!=='object')return[];if(Array.isArray(x))return x.flatMap(nodes);if(x.type==='Modal'&&!x.props.visible)return[];return[x,...nodes(x.props?.children)];}
  function text(x){if(typeof x==='string')return x;if(Array.isArray(x))return x.map(text).join('');return x?.props?text(x.props.children):'';}
  function tap(label){render();const b=nodes(tree).find(x=>x.type==='Pressable'&&text(x)===label);assert.ok(b,label);if(!b.props.disabled)b.props.onPress();render();}
  render();return{calls,helper,client,tap,fail(){fail=true;},recover(){fail=false;},hold(){hold=true;},release(){release();},text:()=>nodes(tree).filter(x=>x.type==='Text').map(text).join(' '),async settle(){await new Promise(r=>setImmediate(r));render();}};
}
test('cancel does nothing; explicit confirmation and rapid taps invoke once without body',async()=>{
 const f=fixture();f.tap('Delete Account');assert.match(f.text(),/cannot be undone/);f.tap('Cancel');assert.deepEqual(f.calls,[]);
 f.tap('Delete Account');f.hold();f.tap('Delete permanently');f.tap('Deleting account\u2026');await f.settle();assert.deepEqual(f.calls,['invoke']);f.release();await f.settle();assert.deepEqual(f.calls,['invoke','reset','channels','signout']);assert.equal(f.helper.isAccountDeleted(),true);
});
test('failure stays generic and retry can succeed without reactivating anything',async()=>{
 const f=fixture();f.fail();f.tap('Delete Account');f.tap('Delete permanently');await f.settle();assert.match(f.text(),/We couldn't finish deleting your account/);assert.ok(!f.text().includes('private-secret'));assert.deepEqual(f.calls,['invoke']);f.recover();f.tap('Delete permanently');await f.settle();assert.equal(f.calls.filter(x=>x==='invoke').length,2);assert.ok(f.calls.includes('reset'));
});
test('cleanup failures do not turn confirmed deletion into deletion failure',async()=>{
 const f=fixture();f.client.removeAllChannels=async()=>{throw Error('private');};f.client.auth.signOut=async()=>{throw Error('private');};await f.helper.deleteAccount();assert.equal(f.helper.isAccountDeleted(),true);assert.ok(f.calls.includes('reset'));
});
test('missing success confirmation fails closed',async()=>{
 const f=fixture();f.client.functions.invoke=async()=>({data:{}});await assert.rejects(f.helper.deleteAccount(),/We couldn't finish/);assert.equal(f.helper.isAccountDeleted(),false);assert.deepEqual(f.calls,[]);
});
test('deletion reset protects navigation and helper has no database writes or privileged credentials',()=>{
 const root=fs.readFileSync('src/app/_layout.tsx','utf8');assert.match(root,/onAccountDeleted\(\(\) =>/);assert.match(root,/signedIn: false, generation: current.generation \+ 1/);assert.match(root,/!isAccountDeleted\(\)/);
 const source=fs.readFileSync('src/lib/delete-account.ts','utf8');assert.doesNotMatch(source,/console\.|service_role|SERVICE_ROLE|\.from\(|\.rpc\(|getUser\(/);
});

