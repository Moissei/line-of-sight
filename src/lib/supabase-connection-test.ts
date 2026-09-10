// Temporary development check. Remove this file and its RootLayout effect to disable it.
let hasRun = false;

function safeErrorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : 'Unknown connection error';
  for (const value of [
    process.env.EXPO_PUBLIC_SUPABASE_URL,
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ]) {
    if (value) message = message.split(value).join('[redacted]');
  }
  return message.replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted URL]');
}

export async function testSupabaseConnection() {
  if (!__DEV__ || hasRun) return;
  hasRun = true;

  try {
    // Import inside the guard so production never initializes the client for this test.
    const { supabase } = await import('./supabase');
    // A real read-only Storage request, not REST-root/OpenAPI introspection or a
    // cached getSession() result. No buckets need to exist; an empty list is valid.
    // Bucket visibility remains governed by the project's existing RLS policies.
    const { data, error } = await supabase.storage.listBuckets({ limit: 1 });

    if (error) {
      throw error;
    }
    if (!Array.isArray(data)) throw new Error('Unexpected response from Supabase Storage');

    console.info('[Supabase connection test] SUCCESS');
  } catch (error) {
    // Never print raw exceptions or responses: they may contain connection details.
    console.error(`[Supabase connection test] ERROR: ${safeErrorMessage(error)}`);
  }
}
