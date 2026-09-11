export const DELETE_ACCOUNT_ERROR = "We couldn't finish deleting your account. Please try again.";

let deleted = false;
const listeners = new Set<() => void>();
export function isAccountDeleted() { return deleted; }
export function onAccountDeleted(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function resetDeletedAccount() { deleted = false; }

export async function deleteAccount(): Promise<void> {
  const { supabase } = await import('./supabase');
  try {
    // The SDK supplies the current session JWT. Deliberately no body or IDs.
    const { data, error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
    if (error || data?.success !== true) throw new Error(DELETE_ACCOUNT_ERROR);
  } catch { throw new Error(DELETE_ACCOUNT_ERROR); }

  deleted = true;
  listeners.forEach(listener => listener());
  // Unmount protected screens immediately, including their caches/watchers.
  // Never run logOut's presence update after deletion. Auth signOut safely
  // tolerates a missing user; cleanup errors cannot undo durable deletion.
  await Promise.allSettled([
    supabase.removeAllChannels(),
    supabase.auth.signOut({ scope: 'local' }),
  ]);
}
