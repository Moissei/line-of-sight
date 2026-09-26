import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { presenceErrorMessage, readDiscoveryPresence, setDiscoveryPresence } from '@/lib/discovery-presence';
import { NearbyResult, pollNearbyDiscovery } from '@/lib/nearby-discovery';
import { NearbyProfileCard, NearbySafetyOptions } from '@/components/nearby-profile-card';
import { DiscoveryBrand } from '@/components/discovery-brand';

export default function DiscoveryScreen() {
  // Only the START LOOKING press may create/reactivate a session.
  // Never derive discoverability from installation, onboarding, or profile intentions.
  const [isLooking, setIsLooking] = useState(false);
  const [locationPending, setLocationPending] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const startController = useRef<AbortController | null>(null);
  const mutation = useRef<Promise<boolean> | null>(null);
  const focused = useRef(false);
  const reconciliation = useRef(0);
  const [presenceReady, setPresenceReady] = useState(false);
  const presenceVerified = useRef(false);
  const [nearby, setNearby] = useState<NearbyResult | null>(null);
  const stopPolling = useRef<(() => void) | null>(null);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = height - insets.top - insets.bottom < 600;
  const short = height - insets.top - insets.bottom < 400;
  const spacing = short ? 8 : compact ? 16 : 24;
  const titleSize = Math.min(short ? 44 : 56, (width - insets.left - insets.right - 56) / 6);
  const showSearchStatus = isLooking && !busy && presenceReady && nearby?.status === 'ready' && nearby.profiles.length === 0;

  const populated = isLooking && !busy && presenceReady && nearby?.status === 'ready' && nearby.profiles.length > 0;

  // Returning checks the existing row; it never starts a session. Do not reset the
  // UI to inactive on blur while a real database row may still be active.
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    focused.current = true;
    const generation = ++reconciliation.current;
    const current = () => !cancelled && generation === reconciliation.current;
    const appState = AppState.addEventListener('change', state => {
      if (state !== 'active') startController.current?.abort();
    });
    presenceVerified.current = false;
    setBusy(true);
    setLocationPending(false);
    setPresenceReady(false);
    setError('');
    // A refocus must read after an outstanding mutation, never race its old row.
    void Promise.resolve(mutation.current).catch(() => {}).then(() => readDiscoveryPresence())
      .then((active) => {
        if (current()) {
          setIsLooking(active);
          presenceVerified.current = true;
          setPresenceReady(true);
        }
      })
      .catch((failure) => { if (current()) setError(presenceErrorMessage(failure)); })
      .finally(() => { if (current()) setBusy(false); });
    return () => {
      cancelled = true;
      focused.current = false;
      presenceVerified.current = false;
      startController.current?.abort();
      appState.remove();
    };
  }, []));

  useFocusEffect(useCallback(() => {
    setNearby(null);
    if (!isLooking || busy || !presenceReady || !presenceVerified.current) return;
    const stop = pollNearbyDiscovery(setNearby);
    stopPolling.current = stop;
    return () => {
      stop();
      stopPolling.current?.();
      stopPolling.current = null;
      setNearby(null);
    };
  }, [isLooking, busy, presenceReady]));

  function removeBlockedProfile(userId: string) {
    // Cancel old RPC/signing completions and discard their signed URL cache.
    const wasPolling = stopPolling.current !== null;
    stopPolling.current?.();
    stopPolling.current = null;
    setNearby((current) => current?.status === 'ready'
      ? { ...current, profiles: current.profiles.filter((item) => item.user_id !== userId) } : current);
    if (wasPolling && presenceVerified.current) {
      stopPolling.current = pollNearbyDiscovery(setNearby);
    }
  }

  async function toggleLooking() {
    if (busy || inFlight.current) return;
    const generation = ++reconciliation.current;
    const current = () => focused.current && generation === reconciliation.current;
    startController.current?.abort();
    const controller = !isLooking ? new AbortController() : null;
    startController.current = controller;
    // Cancel synchronously on STOP, before the database write or React rerender.
    stopPolling.current?.();
    stopPolling.current = null;
    setNearby(null);
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const operation = setDiscoveryPresence(!isLooking, pending => {
        if (current()) setLocationPending(pending);
      }, controller?.signal);
      mutation.current = operation;
      const active = await operation;
      if (!current()) return;
      setIsLooking(active);
      presenceVerified.current = true;
      setPresenceReady(true);
    } catch (failure) {
      if (current() && !controller?.signal.aborted) setError(presenceErrorMessage(failure));
    } finally {
      mutation.current = null;
      if (startController.current === controller) startController.current = null;
      inFlight.current = false;
      if (current()) { setLocationPending(false); setBusy(false); }
    }
  }

  const actionArea = (
        <View style={[styles.footer, { gap: short ? 8 : 16 }]}>
          {locationPending && !isLooking && <Text accessibilityLiveRegion="polite" style={styles.previewNote}>Getting your location…</Text>}
          {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.previewNote}>{error}</Text>}
          <Pressable
            accessibilityRole="button"
            accessibilityHint={isLooking ? 'Stop Looking and stop being visible nearby' : 'Start Looking to become visible to nearby people'}
            accessibilityState={{ disabled: busy, busy }}
            disabled={busy}
            onPress={() => void toggleLooking()}
            style={({ pressed }) => [styles.button, isLooking && styles.stopButton, populated && styles.pairedAction, (pressed || busy) && styles.pressed]}>
            <Text style={[styles.buttonLabel, isLooking && styles.stopLabel, populated && styles.pairedLabel]}>{isLooking ? 'Stop looking' : 'Start looking'}</Text>
          </Pressable>
        </View>
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.screen}>
      <StatusBar style="dark" />
      <View style={[styles.content, { paddingVertical: spacing }]}>
        <DiscoveryBrand active={isLooking} fontSize={titleSize} compact={compact}
          width={Math.max(0, Math.min(404, width - insets.left - insets.right - 56))} />

        <ScrollView style={styles.scroll} contentContainerStyle={[styles.main, { gap: spacing }, (!isLooking || showSearchStatus) && { justifyContent: 'flex-start', paddingTop: Math.min(64, Math.max(24, (height - insets.top - insets.bottom) * 0.07)) }, populated && { justifyContent: 'flex-start', paddingTop: 4, gap: 8 }]}>
          {populated && <Text style={styles.description}>{"You're visible to others who are looking too."}</Text>}
          {!populated && <View style={styles.statusGroup} accessibilityLiveRegion="polite" accessible>
            <View style={styles.stateHeading}>
              {isLooking && <View style={styles.dot} accessible={false} />}
              <Text accessibilityRole="header" style={[styles.statusTitle, { fontSize: short ? 20 : 22 }]}>
                {isLooking ? 'Looking nearby' : 'Ready to be seen?'}
              </Text>
            </View>
            <Text style={styles.description}>
              {isLooking ? "You're visible to others who are looking too." : "You're hidden until you start looking."}
            </Text>
          </View>}
          {isLooking && !busy && presenceReady && !showSearchStatus && (
            <View style={[styles.nearbySection, { paddingTop: populated ? 0 : short ? 4 : compact ? 12 : 20 }]} accessibilityLiveRegion="polite">
              <Text style={[
                styles.nearbyMessage,
                { fontSize: compact ? 16 : 18, lineHeight: compact ? 23 : 26 },
                nearby?.status === 'ready' && nearby.profiles.length > 0 && [
                  styles.nearbyFound,
                  { fontSize: compact ? 18 : 20, lineHeight: compact ? 25 : 28 },
                ],
              ]}>
                {!nearby ? 'Checking your line of sight...'
                  : nearby.status === 'error' ? 'Could not refresh nearby people. We will try again shortly.'
                  : 'Someone is in your line of sight'}
              </Text>
              {nearby?.status === 'ready' && nearby.profiles.map((profile) => (
                <NearbyProfileCard key={profile.user_id} profile={profile} sessionAction={actionArea} onBlocked={() => removeBlockedProfile(profile.user_id)} />
              ))}
            </View>
          )}
          {(!populated && (!isLooking || showSearchStatus)) && (
            <View style={[styles.inactiveAction, { paddingTop: populated ? 24 : compact ? 8 : 16 }]}>
              {actionArea}
            </View>
          )}
          {populated && <View style={styles.safetyFooter}>
            {nearby?.status === 'ready' && nearby.profiles.map(profile => <NearbySafetyOptions key={profile.user_id}
              userId={profile.user_id} name={nearby.profiles.length > 1 ? profile.first_name : undefined}
              onBlocked={() => removeBlockedProfile(profile.user_id)} />)}
          </View>}
        </ScrollView>

        {isLooking && !showSearchStatus && !populated && actionArea}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FEFCF8' },
  content: { flex: 1, width: '100%', maxWidth: 460, alignSelf: 'center', paddingHorizontal: 28 },
  statusGroup: { width: '100%', alignItems: 'center', gap: 12 },
  scroll: { flex: 1, minHeight: 0 },
  main: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 12 },
  stateHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3F6B50', flexShrink: 0 },
  inactiveAction: { width: '100%' },
  statusTitle: { flexShrink: 1, fontWeight: '600', letterSpacing: -0.6, color: '#202D25', textAlign: 'center' },
  description: { maxWidth: 300, fontSize: 15, lineHeight: 22, color: '#656D66', textAlign: 'center' },
  nearbySection: { width: '100%', alignItems: 'center', gap: 10 },
  nearbyMessage: { color: '#202D25', fontWeight: '400', fontStyle: 'normal', textAlign: 'center' },
  nearbyFound: { color: '#253D2F', fontWeight: '600', marginBottom: -6 },
  safetyFooter: { width: '100%', alignItems: 'center', paddingTop: 16, gap: 8 },
  footer: { flexShrink: 0 },
  previewNote: { fontSize: 12, lineHeight: 18, color: '#656D66', textAlign: 'center' },
  button: { width: 200, maxWidth: '100%', minHeight: 48, alignSelf: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#3F6B50', backgroundColor: 'transparent', paddingHorizontal: 20, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { fontSize: 14, fontWeight: '600', color: '#3F6B50', textAlign: 'center' },
  stopButton: { borderColor: '#A65F5F' },
  pairedAction: { width: '100%', minHeight: 48, padding: 14, paddingHorizontal: 14, paddingVertical: 14 },
  pairedLabel: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  stopLabel: { color: '#A65F5F' },
  pressed: { opacity: 0.7 },
});
