export type NearbyProfile = {
  user_id: string;
  primaryPhotoUrl?: string;
  requestRevision?: number;
  first_name: string;
  age: number | null;
  gender: string | null;
  bio: string | null;
  intents: string[];
};

export function parseNearbyProfiles(data: unknown): NearbyProfile[] {
  if (!Array.isArray(data)) throw new Error('Invalid nearby response');
  return data.map((row) => {
    if (!row || typeof row.user_id !== 'string' || typeof row.first_name !== 'string' ||
      !(row.age === null || (typeof row.age === 'number' && Number.isInteger(row.age))) ||
      !(row.gender === null || typeof row.gender === 'string') ||
      !(row.bio === null || typeof row.bio === 'string') ||
      !Array.isArray(row.intents) || !row.intents.every((intent: unknown) => typeof intent === 'string')) {
      throw new Error('Invalid nearby response');
    }
    // Explicit projection: never retain unexpected private fields from a response.
    // Validate structure only; no profile-based eligibility filtering or sorting.
    return { user_id: row.user_id, first_name: row.first_name, age: row.age,
      gender: row.gender, bio: row.bio, intents: [...row.intents] };
  });
}

export type NearbyResult =
  | { status: 'ready'; profiles: NearbyProfile[] }
  | { status: 'error' };

// One request at a time, refreshed five seconds after each response.
export function pollNearbyDiscovery(onResult: (result: NearbyResult) => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  // Per-polling-session cache only: never persisted or shared across screens.
  const photos = new Map<string, { url?: string; expiresAt: number; retryAt: number }>();
  const pending = new Map<string, object>();
  let profiles: NearbyProfile[] = [];
  let requestRevision = 0;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  function publish() {
    if (stopped) return;
    for (const photo of photos.values()) if (photo.expiresAt <= Date.now()) photo.url = undefined;
    onResult({ status: 'ready', profiles: profiles.map((profile) => {
      const photo = photos.get(profile.user_id);
      return { ...profile, primaryPhotoUrl: photo && photo.expiresAt > Date.now() ? photo.url : undefined };
    }) });
    if (expiryTimer) clearTimeout(expiryTimer);
    const deadlines = [...photos.values()].filter((photo) => photo.url && photo.expiresAt > Date.now()).map((photo) => photo.expiresAt);
    if (deadlines.length) expiryTimer = setTimeout(publish, Math.max(1, Math.min(...deadlines) - Date.now()));
  }
  function clearPhotos() {
    profiles = [];
    photos.clear();
    pending.clear();
    if (expiryTimer) clearTimeout(expiryTimer);
  }
  async function signPhoto(userId: string) {
    if (pending.has(userId) || (photos.get(userId)?.retryAt ?? 0) > Date.now()) return;
    // Only canonical UUIDs from RPC results can form Storage paths.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(userId)) return;
    const request = {};
    pending.set(userId, request);
    const started = Date.now();
    let url: string | undefined;
    try {
      const { supabase } = await import('./supabase');
      if (stopped || pending.get(userId) !== request) return;
      const { data, error } = await supabase.storage.from('profile-photos').createSignedUrl(userId + '/1', 60);
      if (!error) url = data?.signedUrl;
    } catch { /* Missing/denied/network failures use the placeholder without logging. */ }
    if (stopped || pending.get(userId) !== request) return;
    pending.delete(userId);
    // Conservative expiry starts before the request, and refresh begins at 45s.
    photos.set(userId, { url, expiresAt: started + 60000, retryAt: started + 45000 });
    publish();
  }

  async function refresh() {
    try {
      const { supabase } = await import('./supabase');
      if (stopped) return;
      const { data, error } = await supabase.rpc('discover_nearby_users')
        .abortSignal(controller.signal);
      if (stopped) return;
      if (error || !Array.isArray(data)) throw new Error('Nearby request failed');
      requestRevision += 1;
      profiles = parseNearbyProfiles(data).map((profile) => ({ ...profile, requestRevision }));
      const eligible = new Set(profiles.map((profile) => profile.user_id));
      for (const id of photos.keys()) if (!eligible.has(id)) photos.delete(id);
      for (const id of pending.keys()) if (!eligible.has(id)) pending.delete(id);
      publish(); // Remove departed people immediately; signing never delays RPC results.
      for (const profile of profiles) void signPhoto(profile.user_id);
    } catch {
      if (!stopped) { clearPhotos(); onResult({ status: 'error' }); }
    } finally {
      if (!stopped) timer = setTimeout(() => void refresh(), 5000);
    }
  }

  void refresh();
  return () => {
    stopped = true;
    clearPhotos();
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  };
}
