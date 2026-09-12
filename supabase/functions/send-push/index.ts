// eslint-disable-next-line import/no-unresolved
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { createPushHandler } from './handler.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false} });
async function rpc(name: string, args = {}) {
  const {data,error} = await admin.rpc(name,args);
  if(error) throw Error('Unavailable');
  return data;
}
Deno.serve(createPushHandler({
  claim: id=>rpc('claim_push_batch',{event_id:id}),
  receipts: ()=>rpc('claim_push_receipts'),
  finish: async (id,lease,outcome,ticket)=>{ await rpc('finish_push_delivery',{delivery_id:id,claim_id:lease,outcome,expo_ticket:ticket ?? null}); },
  async expo(path,body) {
    const access = Deno.env.get('EXPO_ACCESS_TOKEN');
    const response = await fetch(`https://exp.host/--/api/v2/push/${path}`, {
      method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',...(access?{Authorization:`Bearer ${access}`}:{})},
      body:JSON.stringify(body),signal:AbortSignal.timeout(15000),
    });
    if(!response.ok) throw Error('Unavailable');
    return await response.json();
  },
},Deno.env.get('PUSH_WEBHOOK_SECRET') ?? ''));
