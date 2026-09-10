// IDs are internal only. No request/error payloads are logged or displayed.
export async function hasOutgoingRequest(targetUserId: string): Promise<boolean> {
  const { supabase } = await import('./supabase');
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('Request status unavailable');
  const { data, error } = await supabase.from('connection_requests').select('id')
    .eq('sender_id', auth.user.id).eq('recipient_id', targetUserId)
    .in('status', ['pending', 'accepted']).limit(1);
  if (error || !data) throw new Error('Request status unavailable');
  return data.length > 0;
}

export async function sendConnectionRequest(targetUserId: string): Promise<void> {
  const { supabase } = await import('./supabase');
  // Server derives the authenticated sender and checks current nearby eligibility.
  const { data, error } = await supabase.rpc('send_connection_request', { target_user_id: targetUserId });
  if (error || typeof data !== 'string') throw new Error('Request unavailable');
}
