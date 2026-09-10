import * as Location from 'expo-location';

const SESSION_DURATION_MS = 15 * 60 * 1000;
const LOCATION_PERMISSION_ERROR = 'Location access is required to find nearby users. Allow location access in your device or browser settings, then try START LOOKING again.';
const LOCATION_UNAVAILABLE_ERROR = 'We could not get your current location. Check that location services are enabled and try again.';

async function requestCurrentCoordinates() {
  let permission: Location.LocationPermissionResponse;
  try {
    permission = await Location.requestForegroundPermissionsAsync();
  } catch {
    throw new Error(LOCATION_PERMISSION_ERROR);
  }
  if (!permission.granted) throw new Error(LOCATION_PERMISSION_ERROR);

  try {
    // One current fix per explicit START. No background permission or watcher.
    const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const { latitude, longitude } = coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new Error(LOCATION_UNAVAILABLE_ERROR);
    }
    return { latitude, longitude };
  } catch {
    throw new Error(LOCATION_UNAVAILABLE_ERROR);
  }
}

type Presence = { is_active: boolean; expires_at: string | null; updated_at: string };

function isDiscoverable(row: Presence | null): boolean {
  if (!row?.is_active) return false;
  const now = Date.now();
  return new Date(row.updated_at).getTime() + SESSION_DURATION_MS > now &&
    (row.expires_at === null || new Date(row.expires_at).getTime() > now);
}

async function authenticatedClient() {
  const { supabase } = await import('./supabase');
  // Verify the user with Auth, rather than accepting a user ID supplied by the UI.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('Please log in again before managing your discovery session.');
  return { supabase, userId: data.user.id };
}

export async function readDiscoveryPresence(): Promise<boolean> {
  const { supabase, userId } = await authenticatedClient();
  const { data, error } = await supabase.from('active_discovery_sessions')
    .select('is_active, expires_at, updated_at').eq('user_id', userId).maybeSingle();
  if (error) throw new Error('We could not check your session. Please try again in a moment.');
  return isDiscoverable(data);
}

export async function setDiscoveryPresence(active: boolean): Promise<boolean> {
  const { supabase, userId } = await authenticatedClient();
  // Authenticate before requesting permission. STOP never requests or reads location.
  const coordinates = active ? await requestCurrentCoordinates() : undefined;
  const table = supabase.from('active_discovery_sessions');
  const mutation = active
    ? table.upsert({
      user_id: userId,
      is_active: true,
      ...coordinates,
      // Always renew on an explicit START, including after a previously stopped row.
      expires_at: new Date(Date.now() + SESSION_DURATION_MS).toISOString(),
    }, { onConflict: 'user_id' })
    : table.update({ is_active: false }).eq('user_id', userId);

  // Request only non-sensitive status fields. single() detects a zero-row update,
  // including one silently denied by RLS, instead of falsely reporting STOP success.
  const { data, error } = await mutation.select('is_active, expires_at, updated_at').single();
  if (error || !data || data.is_active !== active) {
    throw new Error(active
      ? 'We could not start your session. Please check your connection and try again.'
      : 'We could not confirm that your session stopped. Please try STOP LOOKING again.');
  }
  return isDiscoverable(data);
}

export function presenceErrorMessage(error: unknown): string {
  // Only our own fixed messages may reach the UI. SDK errors and connection details
  // are never displayed or logged (including failures while importing the client).
  const safeMessages = [
    'Please log in again before managing your discovery session.',
    'We could not check your session. Please try again in a moment.',
    LOCATION_PERMISSION_ERROR,
    LOCATION_UNAVAILABLE_ERROR,
    'We could not start your session. Please check your connection and try again.',
    'We could not confirm that your session stopped. Please try STOP LOOKING again.',
  ];
  return error instanceof Error && safeMessages.includes(error.message)
    ? error.message : 'We could not connect. Please check your connection and try again.';
}
