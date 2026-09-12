const fs=require('node:fs');
const ts=require('typescript');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
function load(path) {
  const code=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};new Function('module','exports','crypto',code)(module,module.exports,webcrypto);return module.exports;
}
const client=load('src/lib/push-notifications.ts');
const server=load('supabase/functions/send-push/handler.ts');
const id='11111111-1111-4111-8111-111111111111';
function registration(overrides={}) {
  const calls=[];
  const api={supported:true,android:true,projectId:id,
    async channel(){calls.push('channel');},async permission(){calls.push('permission');return{granted:true,canAskAgain:true};},
    async ask(){calls.push('ask');return{granted:false};},async token(){calls.push('token');return'ExpoPushToken[test]';},
    async register(){calls.push('register');},async unregister(){calls.push('unregister');},...overrides};
  return {calls,api,controller:client.createPushRegistration(api)};
}
test('unsupported devices and missing projectId never prompt or register',async()=>{
  for(const overrides of [{supported:false},{projectId:undefined}]){const f=registration(overrides);await f.controller.refresh();assert.deepEqual(f.calls,[]);}
  const hook=fs.readFileSync('src/lib/use-push-notifications.ts','utf8');
  assert.match(hook,/!signedIn.*Platform.OS==='web'.*!Device.isDevice.*storeClient/);
});
test('permission denied skips token retrieval, channel comes before permission',async()=>{
  const f=registration({async permission(){return{granted:false,canAskAgain:true};}});await f.controller.refresh();assert.deepEqual(f.calls,['channel','ask']);
});
test('successful registration and rotation use Expo tokens and remove old token',async()=>{
  let token='ExpoPushToken[first]';const registered=[],removed=[];
  const f=registration({async token(){return token;},async register(t){registered.push(t);},async unregister(t){removed.push(t);}});
  await f.controller.refresh();token='ExpoPushToken[second]';await f.controller.refresh();
  assert.deepEqual(registered,['ExpoPushToken[first]','ExpoPushToken[second]']);assert.deepEqual(removed,['ExpoPushToken[first]']);
  await f.controller.unregister();assert.deepEqual(removed,['ExpoPushToken[first]','ExpoPushToken[second]']);
});
test('logout cancels delayed registration and unregister failure is harmless',async()=>{
  let release;const f=registration({token:()=>new Promise(r=>release=r)});
  const pending=f.controller.refresh();await new Promise(r=>setImmediate(r));f.controller.stop();release('ExpoPushToken[test]');await pending;assert.ok(!f.calls.includes('register'));
  const g=registration({async unregister(){throw Error('private');}});await g.controller.refresh();client.setPushCleanup(()=>g.controller.unregister());await client.unregisterPushForLogout();
});
test('registration failure is swallowed',async()=>{
  const f=registration({async register(){throw Error('private');}});await f.controller.refresh();await f.controller.unregister();
});
test('notification routing allows only known types and authorized connection IDs',async()=>{
  assert.equal(await client.notificationRoute({type:'connection_request'},async()=>false),'/requests');
  assert.equal(await client.notificationRoute({type:'connection_accepted'},async()=>false),'/connections');
  assert.deepEqual(await client.notificationRoute({type:'new_message',connection_id:id},async value=>value===id),{pathname:'/connection-detail',params:{connectionId:id}});
  assert.equal(await client.notificationRoute({type:'new_message',connection_id:id},async()=>false),null);
  for(const data of [null,{}, {type:'other'}, {type:'new_message',connection_id:'bad'}, {url:'/connection-detail'}])assert.equal(await client.notificationRoute(data,async()=>true),null);
});
function sender(count=0) {
  const calls=[],finished=[];
  const deliveries=Array.from({length:count},(_,i)=>({delivery_id:String(i),lease_id:id,token:`ExpoPushToken[device${i}]`,kind:'new_message',connection_id:id}));
  const api={async claim(){calls.push('claim');return deliveries;},async receipts(){return[];},async finish(...args){finished.push(args);},
    async expo(path,body){calls.push({path,body});return{data:deliveries.map(()=>({status:'ok',id:'ticket'}))};}};
  const handler=server.createPushHandler(api,'mock-server-secret');
  return{api,calls,finished,request:body=>handler(new Request('https://example.invalid',{method:'POST',headers:{'x-push-webhook-secret':'mock-server-secret'},body:JSON.stringify(body??{type:'INSERT',schema:'private',table:'push_outbox',record:{id}})})),handler};
}
test('server rejects user JWT/no secret and GET before any privileged work',async()=>{
  const f=sender();assert.equal((await f.handler(new Request('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer mock-user-jwt'}}))).status,401);
  assert.equal((await f.handler(new Request('https://example.invalid'))).status,405);assert.deepEqual(f.calls,[]);
});
test('zero tokens is successful without Expo call',async()=>{
  const f=sender();assert.equal((await f.request()).status,200);assert.deepEqual(f.calls,['claim']);
});
test('multiple devices get generic messages, tickets persisted and no identity in response',async()=>{
  const f=sender(2);const response=await f.request();assert.equal(response.status,200);assert.deepEqual(await response.json(),{success:true});
  const batch=f.calls[1].body;assert.equal(batch.length,2);
  for(const item of batch){assert.equal(item.title,'New message');assert.equal(item.body,'You received a new message.');assert.deepEqual(item.data,{type:'new_message',connection_id:id});}
  assert.ok(f.finished.every(row=>row[2]==='ticket'));
  const expected={connection_request:['New connection request','Someone wants to connect with you.'],connection_accepted:['Connection accepted','You have a new connection.']};
  for(const [kind,copy] of Object.entries(expected)){const p=server.payload({token:'mock',kind,connection_id:id});assert.deepEqual([p.title,p.body],copy);assert.deepEqual(p.data,{type:kind});}
});
test('invalid ticket disables device; transport failure schedules retry',async()=>{
  const f=sender(1);f.api.expo=async()=>({data:[{status:'error',details:{error:'DeviceNotRegistered'}}]});await f.request();assert.equal(f.finished[0][2],'invalid');
  const g=sender(1);g.api.expo=async()=>{throw Error('private');};const r=await g.request();assert.equal(r.status,503);assert.equal(g.finished[0][2],'retry');assert.deepEqual(await r.json(),{error:'Request unavailable.'});
});
test('receipt sweep handles DeviceNotRegistered without sending notifications',async()=>{
  const f=sender();f.api.receipts=async()=>[{delivery_id:id,lease_id:id,ticket_id:'ticket'}];f.api.expo=async(path)=>{assert.equal(path,'getReceipts');return{data:{ticket:{status:'error',details:{error:'DeviceNotRegistered'}}}};};
  assert.equal((await f.request({action:'receipts'})).status,200);assert.equal(f.finished[0][2],'invalid');assert.deepEqual(f.calls,[]);
});
test('migration contains private ACLs, transactional triggers, unique event guard and lifecycle revalidation',()=>{
  const sql=fs.readFileSync('supabase/migrations/20260911000200_push_notifications.sql','utf8');
  assert.match(sql,/unique\(kind, source_id, recipient_id\)/);
  for(const table of ['connection_requests','connections','messages'])assert.ok(sql.includes(`after insert on public.${table}`));
  assert.match(sql,/private.account_is_active\(a\).*private.account_is_active\(b\)/);
  assert.match(sql,/c.ended_at is null/);assert.match(sql,/public.user_blocks/);
  assert.match(sql,/p.user_id=o.recipient_id and private.push_event_allowed\(o\)/);
  assert.match(sql,/revoke all on private.push_devices, private.push_outbox, private.push_deliveries from public, anon, authenticated, service_role/);
  assert.doesNotMatch(sql,/grant select|net\.http|http_post|new\.body|first_name/);
  assert.match(sql,/references auth.users\(id\) on delete cascade/);
});
test('push code never logs tokens or notification contents',()=>{
  for(const path of ['src/lib/push-notifications.ts','src/lib/use-push-notifications.ts','supabase/functions/send-push/handler.ts','supabase/functions/send-push/index.ts'])assert.doesNotMatch(fs.readFileSync(path,'utf8'),/console\./);
});
