import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

// Broadcast is only an invalidation hint. Never consume its payload as data.
export function watchMessageChanges(
  client: SupabaseClient,
  connectionId: string,
  reload: (signal: AbortSignal) => Promise<void>,
) {
  let stopped = false;
  let subscribed = false;
  let running = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = new AbortController();

  const schedule = () => {
    if (stopped) return;
    pending = true;
    if (running || timer) return;
    timer = setTimeout(() => { timer = undefined; void flush(); }, 250);
  };
  const flush = async () => {
    if (stopped) return;
    pending = false;
    running = true;
    try { await reload(abort.signal); } catch { /* Manual/focus refresh remains available. */ }
    finally {
      running = false;
      if (pending && !stopped) schedule();
    }
  };

  let channel: RealtimeChannel | undefined;
  const join = async () => {
    try {
      const { data, error } = await client.auth.getSession();
      if (stopped || error || !data.session) return;
      // Use the client's Auth token provider; never copy or log a token here.
      await client.realtime.setAuth();
      if (stopped) return;
      channel = client.channel(`connection:${connectionId}`, {
        config: { private: true, broadcast: { ack: true, self: false } },
      });
      channel.on('broadcast', { event: 'messages_changed' }, schedule)
    .subscribe((status) => {
      subscribed = status === 'SUBSCRIBED';
      // The SDK reconnects/rejoins; refresh after every successful join to catch
      // messages whose hints were missed while disconnected.
      if (subscribed) schedule();
      });
    } catch { /* Joining must never break RPC messaging. */ }
  };
  void join();

  return {
    async notify() {
      if (stopped || !subscribed || !channel) return;
      try {
        await channel.send({ type: 'broadcast', event: 'messages_changed', payload: {} });
      } catch { /* Durable send already succeeded. Do not retry it. */ }
    },
    dispose() {
      if (stopped) return;
      stopped = true;
      subscribed = false;
      pending = false;
      clearTimeout(timer);
      abort.abort();
      if (channel) void client.removeChannel(channel).catch(() => { /* No private details logged. */ });
    },
  };
}
