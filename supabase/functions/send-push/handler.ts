export type Delivery = { delivery_id: string; lease_id: string; token: string; kind: string; connection_id: string | null };
export type Receipt = { delivery_id: string; lease_id: string; ticket_id: string };
type Result = { status?: string; id?: string; details?: { error?: string } };
export interface PushServices {
  claim(id: string | null): Promise<Delivery[]>;
  receipts(): Promise<Receipt[]>;
  finish(id: string, lease: string, outcome: string, ticket?: string): Promise<void>;
  expo(path: 'send' | 'getReceipts', body: unknown): Promise<{ data?: unknown }>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const copy: Record<string, [string, string]> = {
  connection_request: ['New connection request', 'Someone wants to connect with you.'],
  connection_accepted: ['Connection accepted', 'You have a new connection.'],
  new_message: ['New message', 'You received a new message.'],
};
export function payload(d: Delivery) {
  if (!Object.hasOwn(copy, d.kind) || (d.kind === 'new_message' && !UUID.test(d.connection_id ?? ''))) throw Error('Unavailable');
  return { to: d.token, title: copy[d.kind][0], body: copy[d.kind][1], sound: 'default', channelId: 'default',
    data: { type: d.kind, ...(d.kind === 'new_message' ? { connection_id: d.connection_id } : {}) } };
}
async function sameSecret(actual: string, expected: string) {
  const hash = async (text: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const [a,b] = await Promise.all([hash(actual),hash(expected)]);
  let diff = 0; for (let i=0;i<a.length;i++) diff |= a[i]^b[i]; return diff === 0;
}
export function createPushHandler(api: PushServices, secret: string) {
  return async (request: Request) => {
    const reply = (status: number) => new Response(JSON.stringify(status===200 ? { success:true } : { error:'Request unavailable.' }),
      { status, headers:{ 'Content-Type':'application/json', 'Cache-Control':'no-store' } });
    if(request.method !== 'POST') return reply(405);
    if(!secret || !(await sameSecret(request.headers.get('x-push-webhook-secret') ?? '',secret))) return reply(401);
    try {
      if(new URL(request.url).search) return reply(400);
      const raw = await request.text();
      if(raw.length>16384) return reply(400);
      const input = JSON.parse(raw);
      let eventId: string | null = null;
      if(input?.type === 'INSERT' && input.schema === 'private' && input.table === 'push_outbox' && UUID.test(input.record?.id ?? '')) {
        eventId = input.record.id;
      } else if(input?.action !== 'drain' && input?.action !== 'receipts') return reply(400);
      if(input.action === 'receipts') {
        const pending = await api.receipts();
        if(!pending.length) return reply(200);
        const result = await api.expo('getReceipts',{ ids:pending.map(r=>r.ticket_id) });
        const receipts = result.data as Record<string,Result> | undefined;
        for(const row of pending) {
          const r = receipts?.[row.ticket_id];
          if(!r) continue; // Remains leased until the next receipt sweep.
          await api.finish(row.delivery_id,row.lease_id,r.details?.error === 'DeviceNotRegistered' ? 'invalid' : r.status==='ok' ? 'done' : 'failed');
        }
      } else {
        const deliveries = await api.claim(eventId);
        if(!deliveries.length) return reply(200);
        // claim returns at most 100, Expo's batch limit. No client-supplied copy.
        let results: Result[];
        try {
          const result = await api.expo('send',deliveries.map(payload));
          if(!Array.isArray(result.data) || result.data.length !== deliveries.length) throw Error('Unavailable');
          results = result.data;
        } catch {
          await Promise.all(deliveries.map(d=>api.finish(d.delivery_id,d.lease_id,'retry')));
          return reply(503);
        }
        for(let i=0;i<deliveries.length;i++) {
          const d=deliveries[i], r=results[i];
          await api.finish(d.delivery_id,d.lease_id,
            r?.details?.error==='DeviceNotRegistered' ? 'invalid' : r?.status==='ok' && typeof r.id==='string' ? 'ticket' : 'retry',r?.id);
        }
      }
      return reply(200);
    } catch { return reply(503); }
  };
}
