// Deno resolves this pinned npm specifier; validated with deno check.
// eslint-disable-next-line import/no-unresolved
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { createDeleteAccountHandler, type DeletionState } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const origins = (Deno.env.get('DELETE_ACCOUNT_ALLOWED_ORIGINS') ?? '').split(',').map(x => x.trim()).filter(Boolean);
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
// Never install the caller's Authorization header on the privileged client.
const admin = createClient(url, service, options);
const verifier = createClient(url, anon, options);
const bucket = admin.storage.from('profile-photos');
async function rpc(name: string, id: string) {
  const { data, error } = await admin.rpc(name, { p_user_id: id });
  if (error) throw new Error('Operation failed');
  return data;
}
const handler = createDeleteAccountHandler({
  async verify(token) {
    try {
      const { data, error } = await verifier.auth.getClaims(token);
      const claims = data?.claims;
      const now = Date.now() / 1000;
      if (error || !claims || claims.role !== 'authenticated' || claims.iss !== `${url}/auth/v1`
        || claims.aud !== 'authenticated' || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= now
        || typeof claims.sub !== 'string'
        || (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf) || claims.nbf > now))) return null;
      return claims.sub;
    } catch { return null; }
  },
  async currentUser(token, id) {
    const { data, error } = await verifier.auth.getUser(token);
    return !error && data.user?.id === id;
  },
  async status(id) {
    const state = await rpc('account_deletion_status', id);
    if (!['active', 'pending', 'prepared', 'deleted'].includes(state)) throw new Error('Invalid state');
    return state as DeletionState;
  },
  async begin(id) { await rpc('begin_account_deletion', id); },
  async list(prefix, offset, limit) {
    const { data, error } = await bucket.list(prefix, { offset, limit, sortBy: { column: 'name', order: 'asc' } });
    if (error || !data) throw new Error('Storage unavailable');
    return data.map(row => ({ name: row.name, id: row.id }));
  },
  async remove(paths) {
    const { error } = await bucket.remove(paths);
    if (error) throw new Error('Storage unavailable');
  },
  async prepare(id) { await rpc('prepare_account_auth_deletion', id); },
  async deleteAuth(id) {
    const { error } = await admin.auth.admin.deleteUser(id, false);
    if (error) throw new Error('Auth unavailable');
  },
}, origins);
Deno.serve(handler);
