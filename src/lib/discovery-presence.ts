import * as Location from 'expo-location';
import { Platform } from 'react-native';

const SESSION_DURATION_MS = 15 * 60 * 1000;
const LOCATION_PERMISSION_ERROR = 'Location access is required to find nearby users. Allow location access in your device or browser settings, then try START LOOKING again.';
const PRECISE_LOCATION_ERROR = 'Precise Location is required to find people nearby. Enable Precise Location for Line of Sight in device settings, then try START LOOKING again.';
const LOCATION_QUALITY_ERROR = 'We could not get a sufficiently current, accurate location. Try again where location reception is better.';
const LOCATION_UNAVAILABLE_ERROR = 'We could not get your current location. Check that location services are enabled and try again.';
const LOCATION_TIMEOUT_ERROR = 'We couldn’t get an accurate location yet. Try again where location reception is better.';
const LOCATION_CANCELLED_ERROR = 'Location acquisition cancelled.';

// A pending native setup can outlive cancellation. Do not overlap its replacement.
let androidAcquisitionBusy = false;
function acquireAndroidLocation(signal?: AbortSignal): Promise<Location.LocationObject> {
  if (androidAcquisitionBusy) return Promise.reject(new Error(LOCATION_UNAVAILABLE_ERROR));
  androidAcquisitionBusy = true;
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + 8000;
    let settled = false;
    let setupPending = false;
    let subscription: Location.LocationSubscription | undefined;
    const timer = setTimeout(() => finish(undefined, LOCATION_TIMEOUT_ERROR), 8000);
    function remove() {
      if (!subscription) return;
      const handle = subscription;
      subscription = undefined;
      // Expo removes JS callbacks synchronously; native teardown is not awaitable.
      handle.remove();
    }
    function finish(location?: Location.LocationObject, error?: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      remove();
      if (!setupPending) androidAcquisitionBusy = false;
      if (location) resolve(location); else reject(new Error(error ?? LOCATION_UNAVAILABLE_ERROR));
    }
    function cancel() { finish(undefined, LOCATION_CANCELLED_ERROR); }
    function canContinue() {
      if (settled) return false;
      if (signal?.aborted) { cancel(); return false; }
      if (performance.now() >= deadline) { finish(undefined, LOCATION_TIMEOUT_ERROR); return false; }
      return true;
    }
    signal?.addEventListener('abort', cancel, { once: true });
    if (!canContinue()) return;
    void (async () => {
      let cached: Location.LocationObject | null = null;
      try { cached = await Location.getLastKnownPositionAsync({ maxAge: 3000, requiredAccuracy: 15 }); }
      catch { /* A cache failure still permits fresh acquisition. */ }
      if (!canContinue()) return;
      if (acceptableLocation(cached)) {
        finish(cached);
        return;
      }
      setupPending = true;
      try {
        subscription = await Location.watchPositionAsync({
          accuracy: Location.Accuracy.High, timeInterval: 1000,
          distanceInterval: 0, mayShowUserSettingsDialog: false,
        }, location => {
          if (!canContinue()) return;
          if (acceptableLocation(location)) {
            finish(location);
          }
        }, () => { if (canContinue()) finish(undefined, LOCATION_UNAVAILABLE_ERROR); });
        if (settled) remove();
        else canContinue();
      } catch {
        // Expo supplies no removal handle when setup rejects.
        finish(undefined, LOCATION_UNAVAILABLE_ERROR);
      } finally {
        setupPending = false;
        if (settled) androidAcquisitionBusy = false;
      }
    })().catch(() => finish(undefined, LOCATION_UNAVAILABLE_ERROR));
  });
}

function checkCancellation(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error(LOCATION_CANCELLED_ERROR);
}

async function requestCurrentCoordinates(signal?: AbortSignal) {
  checkCancellation(signal);
  let permission: Location.LocationPermissionResponse;
  try {
    permission = await Location.requestForegroundPermissionsAsync();
  } catch {
    throw new Error(LOCATION_PERMISSION_ERROR);
  }
  if (!permission.granted) throw new Error(LOCATION_PERMISSION_ERROR);
  checkCancellation(signal);

  if (Platform.OS === 'android' && permission.android?.accuracy !== 'fine') {
    throw new Error(PRECISE_LOCATION_ERROR);
  }
  if (Platform.OS === 'android') {
    return acquireAndroidLocation(signal);
  }
  let location: Location.LocationObject;
  try {
    // Explicit START only; no watcher, background collection, or application cache.
    location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
  } catch {
    throw new Error(LOCATION_UNAVAILABLE_ERROR);
  }
  if (!validCoordinates(location)) {
    throw new Error(LOCATION_QUALITY_ERROR);
  }
  return location;
}

function validCoordinates(location: Location.LocationObject | null): location is Location.LocationObject {
  const coords = location?.coords;
  return !!coords && Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude) &&
    coords.latitude >= -90 && coords.latitude <= 90 && coords.longitude >= -180 && coords.longitude <= 180;
}

function acceptableLocation(location: Location.LocationObject | null): location is Location.LocationObject {
  if (!validCoordinates(location)) return false;
  const age = Date.now() - location.timestamp;
  const accuracy = location.coords.accuracy;
  return Number.isFinite(location.timestamp) && age >= 0 && age <= 3000 &&
    typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy > 0 && accuracy <= 15;
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

export async function setDiscoveryPresence(active: boolean, onLocationPending?: (pending: boolean) => void, signal?: AbortSignal): Promise<boolean> {
  const { supabase, userId } = await authenticatedClient();
  if (active) checkCancellation(signal);
  // Authenticate before requesting permission. STOP never requests or reads location.
  let location: Location.LocationObject | undefined;
  if (active) {
    onLocationPending?.(true);
    try { location = await requestCurrentCoordinates(signal); }
    finally { onLocationPending?.(false); }
  }
  const table = supabase.from('active_discovery_sessions');
  if (active) checkCancellation(signal);
  if (location && Platform.OS === 'android' && !acceptableLocation(location)) {
    throw new Error(LOCATION_QUALITY_ERROR);
  }
  const mutation = active
    ? table.upsert({
      user_id: userId,
      is_active: true,
      latitude: location!.coords.latitude,
      longitude: location!.coords.longitude,
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
  const discoverable = isDiscoverable(data);
  return discoverable;
}

export function presenceErrorMessage(error: unknown): string {
  // Only our own fixed messages may reach the UI. SDK errors and connection details
  // are never displayed or logged (including failures while importing the client).
  const safeMessages = [
    'Please log in again before managing your discovery session.',
    'We could not check your session. Please try again in a moment.',
    LOCATION_PERMISSION_ERROR,
    PRECISE_LOCATION_ERROR,
    LOCATION_QUALITY_ERROR,
    LOCATION_UNAVAILABLE_ERROR,
    LOCATION_TIMEOUT_ERROR,
    'We could not start your session. Please check your connection and try again.',
    'We could not confirm that your session stopped. Please try STOP LOOKING again.',
  ];
  return error instanceof Error && safeMessages.includes(error.message)
    ? error.message : 'We could not connect. Please check your connection and try again.';
}
