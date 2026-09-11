export const LOGOUT_ERROR = 'Couldn’t log out. Please try again.';

export async function logOut(): Promise<void> {
  const { supabase } = await import('./supabase');
  // STOP is best effort: no location access, and a missing presence row is fine.
  try {
    const { data, error } = await supabase.auth.getUser();
    if (!error && data.user) {
      await supabase.from('active_discovery_sessions').update({ is_active: false })
        .eq('user_id', data.user.id).abortSignal(AbortSignal.timeout(5000));
    }
  } catch { /* Do not trap a user in the app when presence is unavailable. */ }
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw new Error(LOGOUT_ERROR);
  } catch { throw new Error(LOGOUT_ERROR); }
  // SIGNED_OUT resets the root navigator/provider, unmounting screen caches and
  // their polling/watchers. Channel teardown must not turn success into failure.
  try { await supabase.removeAllChannels(); } catch { /* Local screens are gone. */ }
}
