export type SafetyTarget = { kind: 'user' | 'connection'; id: string };
export const REPORT_REASONS = ['Harassment', 'Spam', 'Fake profile', 'Inappropriate content', 'Safety concern', 'Other'] as const;
export const ACTION_ERROR = 'Couldn’t complete that action. Please try again.';
export const BLOCK_TITLE = 'Block this person?';
export function blockDescription(kind: SafetyTarget['kind']) {
  return kind === 'user'
    ? 'You won’t see each other in discovery or be able to send connection requests.'
    : 'This connection will end and you won’t be able to access this chat anymore.';
}
export function validReport(reason: string, details: string) {
  return REPORT_REASONS.some((value) => value === reason) && Array.from(details).length <= 1000;
}
export async function performSafetyAction(target: SafetyTarget, action: 'block' | 'report', reason = '', details = '') {
  if (action === 'report' && !validReport(reason, details)) throw new Error(ACTION_ERROR);
  try {
    const { supabase } = await import('./supabase');
    const params = target.kind === 'user' ? { target_user_id: target.id } : { connection_id: target.id };
    const { error } = await supabase.rpc(`${action}_${target.kind}`, {
      ...params, ...(action === 'report' ? { reason, details: details.trim() || null } : {}),
    });
    if (error) throw new Error(ACTION_ERROR);
  } catch { throw new Error(ACTION_ERROR); }
}

// Synchronous lock covers taps before React can render the disabled state.
export async function runSafetyAction(lock: { current: boolean }, operation: () => Promise<void>) {
  if (lock.current) return false;
  lock.current = true;
  try { await operation(); return true; } finally { lock.current = false; }
}

// Cleanup is best effort after a durable block; navigation must still happen.
export function leaveBlockedChat(dispose: () => void, leave: () => void) {
  try { dispose(); } catch { /* RPC success remains success. */ }
  finally { leave(); }
}
