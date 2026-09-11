const { Buffer } = require('node:buffer');
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync('supabase/functions/delete-account/handler.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const box={exports:{}};new Function('module','exports',code)(box,box.exports);const {createDeleteAccountHandler}=box.exports;
const id='11111111-1111-4111-8111-111111111111';
function fixture(initial='active'){
 let state=initial,verified=true,current=true,failStorage=false,failAuth=false,failPrepare=false,lost=false;
 const objects=new Set([`${id}/1`,`${id}/2`,`${id}/3`,`${id}/profile`]);const calls=[];
 const api={async verify(){return verified?id:null;},async currentUser(){return current;},async status(){return state;},
 async begin(target){assert.equal(target,id);calls.push('begin');if(state==='active')state='pending';},
 async list(prefix,offset,limit){calls.push('list');if(failStorage)throw Error('sensitive');
 const entries=new Map();for(const path of objects){if(!path.startsWith(prefix+'/'))continue;const remainder=path.slice(prefix.length+1);const parts=remainder.split('/');entries.set(parts[0],{name:parts[0],id:parts.length>1?null:'file'});}
 return [...entries.values()].sort((a,b)=>a.name.localeCompare(b.name)).slice(offset,offset+limit);},
 async remove(paths){calls.push('remove');for(const path of paths){assert.ok(path.startsWith(id+'/'));objects.delete(path);}},
 async prepare(){calls.push('prepare');if(failPrepare)throw Error('sensitive');assert.equal(objects.size,0);state='prepared';},
 async deleteAuth(){calls.push('deleteAuth');if(failAuth)throw Error('sensitive');state='deleted';if(lost)throw Error('lost response');}};
 const handler=createDeleteAccountHandler(api,['https://app.example']);
 return {objects,calls,handler,state:()=>state,api,
 set(options){({verified=verified,current=current,failStorage=failStorage,failAuth=failAuth,failPrepare=failPrepare,lost=lost}=options);},
 request(options={}){return handler(new Request('https://function.example/delete-account',{method:'POST',headers:{Authorization:'Bearer verified-token'},...options}));}};
}
for(const state of ['active','pending','prepared'])test(`successful lifecycle/retry from ${state}`,async()=>{const f=fixture(state);const r=await f.request();assert.equal(r.status,200);assert.deepEqual(await r.json(),{success:true});assert.equal(f.state(),'deleted');assert.equal(f.objects.size,0);assert.ok(f.calls.indexOf('prepare')>f.calls.indexOf('remove'));});
test('missing/invalid JWT rejected before lifecycle',async()=>{const f=fixture();assert.equal((await f.request({headers:{}})).status,401);f.set({verified:false});assert.equal((await f.request()).status,401);assert.deepEqual(f.calls,[]);});
test('body/query targets forbidden',async()=>{const f=fixture();assert.equal((await f.request({body:JSON.stringify({target_user_id:id})})).status,400);assert.equal((await f.handler(new Request('https://function.example?user_id=x',{method:'POST'}))).status,400);assert.equal(f.calls.length,0);});
test('Storage failure preserves pending; retry finishes',async()=>{const f=fixture();f.set({failStorage:true});const r=await f.request();assert.equal(r.status,503);assert.equal(f.state(),'pending');assert.equal(f.calls.includes('deleteAuth'),false);assert.equal((await r.text()).includes(id),false);f.set({failStorage:false});assert.equal((await f.request()).status,200);});
test('prepare failure retry and Auth failure retry',async()=>{const f=fixture();f.set({failPrepare:true});assert.equal((await f.request()).status,503);assert.equal(f.state(),'pending');f.set({failPrepare:false,failAuth:true});assert.equal((await f.request()).status,503);assert.equal(f.state(),'prepared');f.set({failAuth:false});assert.equal((await f.request()).status,200);});
test('recursive pagination includes unexpected additional files and isolates other prefixes',async()=>{const f=fixture();for(let i=0;i<230;i++)f.objects.add(`${id}/nested/deeper/file${i}`);const r=await f.request();assert.equal(r.status,200);assert.equal(f.objects.size,0);assert.ok(f.calls.filter(x=>x==='remove').length>=3);});
test('verification detects a no-op Storage removal',async()=>{const f=fixture();f.api.remove=async()=>{};assert.equal((await f.request()).status,503);assert.equal(f.calls.includes('prepare'),false);});
test('lost Auth success response reconciles; deleted retry needs verified JWT only',async()=>{const f=fixture();f.set({lost:true});assert.equal((await f.request()).status,200);f.calls.length=0;f.set({current:false});assert.equal((await f.request()).status,200);assert.deepEqual(f.calls,[]);f.set({verified:false});assert.equal((await f.request()).status,401);});
test('fresh Auth user required before destructive work',async()=>{const f=fixture();f.set({current:false});assert.equal((await f.request()).status,401);assert.equal(f.calls.length,0);});
test('CORS and methods; errors never echo secrets or internal values',async()=>{const f=fixture();assert.equal((await f.request({method:'GET'})).status,405);assert.equal((await f.request({method:'OPTIONS',headers:{Origin:'https://app.example'}})).status,204);assert.equal((await f.request({headers:{Origin:'https://evil.example'}})).status,403);f.set({failStorage:true});const r=await f.request();const body=await r.text();for(const value of [id,'sensitive','verified-token','pending','profile-photos'])assert.equal(body.includes(value),false);});
test('runtime adapter verifies claims and current Auth identity; admin client stays separate',async()=>{
 const runtime=ts.transpileModule(fs.readFileSync('supabase/functions/delete-account/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 let adapter;const claims={sub:id,role:'authenticated',aud:'authenticated',iss:'https://project.example/auth/v1',exp:Date.now()/1000+60};let bad=false;
 const admin={storage:{from:()=>({})}};
 const verifier={auth:{async getClaims(){return{data:{claims:{...claims,...(bad?{role:'service_role'}:{})}},error:null};},async getUser(){return{data:{user:{id}},error:null};}}};
 let creates=0;const sdk={createClient(url,key,options){assert.equal(url,'https://project.example');assert.equal(options.auth.persistSession,false);assert.equal(options.global,undefined);assert.equal(key,creates++===0?'server-test-key':'anon-test-key');return creates===1?admin:verifier;}};
 const module={exports:{}};new Function('require','module','exports','Deno',runtime)(name=>name.startsWith('npm:')?sdk:{createDeleteAccountHandler(api){adapter=api;return()=>{};}},module,module.exports,{env:{get(name){return{SUPABASE_URL:'https://project.example',SUPABASE_ANON_KEY:'anon-test-key',SUPABASE_SERVICE_ROLE_KEY:'server-test-key'}[name];}},serve(){}});
 assert.equal(await adapter.verify('test-token'),id);assert.equal(await adapter.currentUser('test-token',id),true);assert.equal(await adapter.currentUser('test-token','other'),false);
 bad=true;assert.equal(await adapter.verify('test-token'),null);
});
test('cryptographically verified JWTs gate tombstone access; missing Auth never blocks completed retry',async()=>{
 const {createClient}=require('@supabase/supabase-js');
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'test-key',alg:'ES256',use:'sig'};
 let authReads=0,statusReads=0,state='deleted',served;
 const client=createClient('https://project.example','test-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async()=>{throw Error('Network forbidden');}}});
 const base={sub:id,role:'authenticated',aud:'authenticated',iss:'https://project.example/auth/v1',exp:Math.floor(Date.now()/1000)+300};
 async function token(changes={}){const header=Buffer.from(JSON.stringify({alg:'ES256',kid:'test-key',typ:'JWT'})).toString('base64url');const payload=Buffer.from(JSON.stringify({...base,...changes})).toString('base64url');const input=`${header}.${payload}`;const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(input));return `${input}.${Buffer.from(signature).toString('base64url')}`;}
 const admin={storage:{from:()=>({})},async rpc(name,params){assert.equal(name,'account_deletion_status');assert.deepEqual(params,{p_user_id:id});statusReads++;return{data:state,error:null};}};
 const verifier={auth:{getClaims:jwt=>client.auth.getClaims(jwt,{jwks:{keys:[jwk]}}),async getUser(){authReads++;return{data:{user:null},error:{}};}}};
 let count=0;const runtime=ts.transpileModule(fs.readFileSync('supabase/functions/delete-account/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};new Function('require','module','exports','Deno',runtime)(name=>name.startsWith('npm:')?{createClient:()=>count++===0?admin:verifier}:{createDeleteAccountHandler},module,module.exports,{env:{get:name=>({SUPABASE_URL:'https://project.example',SUPABASE_ANON_KEY:'test',SUPABASE_SERVICE_ROLE_KEY:'server'})[name]},serve:fn=>{served=fn;}});
 async function request(jwt){return served(new Request('https://function.example',{method:'POST',headers:{Authorization:`Bearer ${jwt}`}}));}
 const valid=await token();const done=await request(valid);assert.equal(done.status,200);assert.deepEqual(await done.json(),{success:true});assert.equal(authReads,0);assert.equal(statusReads,1);
 const pieces=valid.split('.');pieces[1]=Buffer.from(JSON.stringify({...base,sub:'22222222-2222-4222-8222-222222222222'})).toString('base64url');
 const invalid=['malformed',pieces.join('.'),await token({exp:1}),await token({iss:'https://other.example/auth/v1'}),await token({aud:'service_role'}),await token({role:'service_role'}),await token({nbf:Date.now()/1000+600}),await token({sub:'not-a-uuid'})];
 for(const jwt of invalid){const result=await request(jwt);assert.equal(result.status,401);assert.equal(statusReads,1);const body=await result.text();assert.equal(body.includes(id),false);assert.equal(body.includes('deleted'),false);}
 for(const next of ['active','pending','prepared']){state=next;assert.equal((await request(valid)).status,401);}assert.equal(authReads,3);
 for(const field of ['userId','targetUserId','target_user_id']){const response=await served(new Request('https://function.example',{method:'POST',headers:{Authorization:`Bearer ${valid}`},body:JSON.stringify({[field]:'other'})}));assert.equal(response.status,400);}
 assert.match(fs.readFileSync('supabase/config.toml','utf8'),/verify_jwt = true/);
});
