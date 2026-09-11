export type DeletionState = 'active' | 'pending' | 'prepared' | 'deleted';
export interface DeletionServices {
  verify(token: string): Promise<string | null>;
  currentUser(token: string, id: string): Promise<boolean>;
  status(id: string): Promise<DeletionState>;
  begin(id: string): Promise<void>;
  list(prefix: string, offset: number, limit: number): Promise<{ name: string; id: string | null }[]>;
  remove(paths: string[]): Promise<void>;
  prepare(id: string): Promise<void>;
  deleteAuth(id: string): Promise<void>;
}
const PAGE = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Enumerate fully before deleting: deleting while advancing offsets skips rows.
// Folders are virtual entries (id=null), so recurse, never remove folder rows.
export async function inventory(api: DeletionServices, id: string): Promise<string[]> {
  const folders = [id];
  const visited = new Set<string>();
  const files = new Set<string>();
  let pages = 0;
  while (folders.length) {
    const prefix = folders.pop()!;
    if (visited.has(prefix)) continue;
    visited.add(prefix);
    for (let offset = 0; ; offset += PAGE) {
      // Bound pathological inventories/runtime. Failure leaves lifecycle retryable.
      if (++pages > 2000) throw new Error('Inventory limit');
      const rows = await api.list(prefix, offset, PAGE);
      for (const row of rows) {
        if (!row.name || row.name === '.' || row.name === '..' || /[\\/\u0000]/.test(row.name)) throw new Error('Invalid entry');
        const path = `${prefix}/${row.name}`;
        if (!path.startsWith(`${id}/`)) throw new Error('Invalid prefix');
        if (row.id === null) folders.push(path); else files.add(path);
      }
      if (rows.length < PAGE) break;
    }
  }
  return [...files];
}

export function createDeleteAccountHandler(api: DeletionServices, allowedOrigins: string[]) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' });
    if (origin && allowedOrigins.includes(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
      headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    }
    const reply = (status: number, ok = false) => new Response(JSON.stringify(ok ? { success: true } : { error: 'Could not complete this request. Please try again.' }), { status, headers });
    if (origin && !allowedOrigins.includes(origin)) return reply(403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') { headers.set('Allow', 'POST, OPTIONS'); return reply(405); }
    if (new URL(request.url).search) return reply(400);
    // No input payload is accepted, including a target identity or confirmation flag.
    if (request.body !== null) return reply(400);
    const match = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') ?? '');
    if (!match) return reply(401);
    try {
      const id = await api.verify(match[1]);
      if (!id || !UUID.test(id)) return reply(401);
      if (await api.status(id) === 'deleted') return reply(200, true);
      if (!await api.currentUser(match[1], id)) return reply(401);
      await api.begin(id);
      // Repeat enumeration after deletion; concurrent retries/removals are safe.
      // The DB pending gate fences new ordinary-client metadata writes.
      for (let pass = 0; pass < 3; pass++) {
        const paths = await inventory(api, id);
        if (!paths.length) break;
        for (let i = 0; i < paths.length; i += PAGE) await api.remove(paths.slice(i, i + PAGE));
      }
      if ((await inventory(api, id)).length) return reply(503);
      await api.prepare(id);
      try { await api.deleteAuth(id); }
      catch {
        // Another retry may have finished, or Auth committed before transport failed.
        if (await api.status(id) !== 'deleted') return reply(503);
      }
      if (await api.status(id) !== 'deleted') return reply(503);
      return reply(200, true);
    } catch { return reply(503); }
  };
}
