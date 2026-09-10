export type NearbyProfile = {
  user_id: string;
  first_name: string;
  age: number | null;
  gender: string | null;
  bio: string | null;
  intents: string[];
  distance_meters: number;
};

export function parseNearbyProfiles(data: unknown): NearbyProfile[] {
  if (!Array.isArray(data)) throw new Error('Invalid nearby response');
  return data.map((row) => {
    if (!row || typeof row.user_id !== 'string' || typeof row.first_name !== 'string' ||
      !(row.age === null || (typeof row.age === 'number' && Number.isInteger(row.age))) ||
      !(row.gender === null || typeof row.gender === 'string') ||
      !(row.bio === null || typeof row.bio === 'string') ||
      !Array.isArray(row.intents) || !row.intents.every((intent: unknown) => typeof intent === 'string') ||
      typeof row.distance_meters !== 'number' || !Number.isFinite(row.distance_meters) || row.distance_meters < 0) {
      throw new Error('Invalid nearby response');
    }
    // Explicit projection: never retain unexpected private fields from a response.
    // Validate structure only; no profile-based eligibility filtering or sorting.
    return { user_id: row.user_id, first_name: row.first_name, age: row.age,
      gender: row.gender, bio: row.bio, intents: [...row.intents], distance_meters: row.distance_meters };
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

  async function refresh() {
    try {
      const { supabase } = await import('./supabase');
      if (stopped) return;
      const { data, error } = await supabase.rpc('discover_nearby_users')
        .abortSignal(controller.signal);
      if (stopped) return;
      if (error || !Array.isArray(data)) throw new Error('Nearby request failed');
      onResult({ status: 'ready', profiles: parseNearbyProfiles(data) });
    } catch {
      if (!stopped) onResult({ status: 'error' });
    } finally {
      if (!stopped) timer = setTimeout(() => void refresh(), 5000);
    }
  }

  void refresh();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  };
}
