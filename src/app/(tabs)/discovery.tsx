import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { presenceErrorMessage, readDiscoveryPresence, setDiscoveryPresence } from '@/lib/discovery-presence';
import { NearbyResult, pollNearbyDiscovery } from '@/lib/nearby-discovery';
import { NearbyProfileCard } from '@/components/nearby-profile-card';
import { DiscoveryBrand } from '@/components/discovery-brand';

export default function DiscoveryScreen() {
  // Only the START LOOKING press may create/reactivate a session.
  // Never derive discoverability from installation, onboarding, or profile intentions.
  const [isLooking, setIsLooking] = useState(false);
  const [busy, setBusy] = useState(true);
  const [statusLift, setStatusLift] = useState(0);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
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

  // Returning checks the existing row; it never starts a session. Do not reset the
  // UI to inactive on blur while a real database row may still be active.
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    presenceVerified.current = false;
    setBusy(true);
    setPresenceReady(false);
    setError('');
    void readDiscoveryPresence()
      .then((active) => {
        if (!cancelled) {
          setIsLooking(active);
          presenceVerified.current = true;
          setPresenceReady(true);
        }
      })
      .catch((failure) => { if (!cancelled) setError(presenceErrorMessage(failure)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; presenceVerified.current = false; };
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
    // Cancel synchronously on STOP, before the database write or React rerender.
    stopPolling.current?.();
    stopPolling.current = null;
    setNearby(null);
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const active = await setDiscoveryPresence(!isLooking);
      setIsLooking(active);
      presenceVerified.current = true;
      setPresenceReady(true);
    } catch (failure) {
      setError(presenceErrorMessage(failure));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const actionArea = (
        <View style={[styles.footer, { gap: short ? 8 : 16 }]}>
          {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.previewNote}>{error}</Text>}
          <Pressable
            accessibilityRole="button"
            accessibilityHint={isLooking ? 'End the discovery preview session' : 'Explicitly start a discovery preview session'}
            accessibilityState={{ disabled: busy, busy }}
            disabled={busy}
            onPress={() => void toggleLooking()}
            style={({ pressed }) => [styles.button, { minHeight: compact ? 48 : 58, paddingVertical: compact ? 12 : 18 }, (pressed || busy) && styles.pressed]}>
            <Text style={styles.buttonLabel}>{isLooking ? 'STOP LOOKING' : 'START LOOKING'}</Text>
          </Pressable>
        </View>
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.screen}>
      <StatusBar style="dark" />
      <View style={[styles.content, { paddingVertical: spacing }]}>
        <DiscoveryBrand active={isLooking} fontSize={titleSize} compact={compact}
          width={Math.max(0, Math.min(404, width - insets.left - insets.right - 56))} />

        <ScrollView style={styles.scroll} contentContainerStyle={[styles.main, { gap: spacing }, !isLooking && { paddingVertical: compact ? 24 : 48 }]}>
          <View onLayout={({ nativeEvent }) => setStatusLift(Math.min(38, Math.max(0, nativeEvent.layout.y - 12)))}
            style={[styles.statusGroup, { gap: spacing }, isLooking && { transform: [{ translateY: -statusLift }] }]}>
            <View style={[styles.badge, isLooking ? styles.activeBadge : styles.inactiveBadge]}>
              <View style={[styles.dot, isLooking && styles.activeDot]} />
              <Text style={[styles.badgeLabel, isLooking && styles.activeLabel]}>
                {isLooking ? 'SESSION ACTIVE' : 'SESSION INACTIVE'}
              </Text>
            </View>

            <View style={[styles.message, !isLooking && styles.inactiveMessage]} accessibilityLiveRegion="polite" accessible>
              {isLooking && <Text style={[styles.statusTitle, { fontSize: short ? 20 : 22 }]}>
                  You are discoverable
              </Text>}
              <Text style={[styles.description, !isLooking && styles.inactiveDescription, { fontSize: short ? 14 : 16, lineHeight: short ? 20 : 24 }, isLooking && styles.activeDescription]}>
                {isLooking
                  ? 'You’re visible to nearby users while Line of Sight looks for others who are active nearby.'
                  : 'You are not currently visible to nearby users. Start looking when you are ready to connect.'}
              </Text>
            </View>
          </View>
          {isLooking && !busy && presenceReady && !showSearchStatus && (
            <View style={[styles.nearbySection, { paddingTop: short ? 4 : compact ? 12 : 20 }]} accessibilityLiveRegion="polite">
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
                <NearbyProfileCard key={profile.user_id} profile={profile} onBlocked={() => removeBlockedProfile(profile.user_id)} />
              ))}
            </View>
          )}
          {!isLooking && (
            <View style={[styles.inactiveAction, { paddingTop: compact ? 16 : 24 }]}>
              {actionArea}
            </View>
          )}
        </ScrollView>

        {isLooking && actionArea}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FEFCF8' },
  content: { flex: 1, width: '100%', maxWidth: 460, alignSelf: 'center', paddingHorizontal: 28 },
  statusGroup: { width: '100%', alignItems: 'center' },
  activeDescription: { alignSelf: 'center', maxWidth: 300, fontSize: 15, lineHeight: 22 },
  scroll: { flex: 1, minHeight: 0 },
  main: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 12 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14,
    paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#C9CEC7',
  },
  inactiveBadge: { borderColor: '#D8D0BC' },
  inactiveMessage: { alignItems: 'center', gap: 16 },
  inactiveDescription: { width: '100%', maxWidth: 300 },
  inactiveAction: { width: '100%' },
  activeBadge: { backgroundColor: '#253D2F', borderColor: '#253D2F' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#656D66' },
  activeDot: { backgroundColor: '#FEFCF8' },
  badgeLabel: { fontSize: 11, letterSpacing: 1, fontWeight: '600', color: '#656D66' },
  activeLabel: { color: '#FFFFFF' },
  message: { width: '100%', gap: 12 },
  statusTitle: { fontWeight: '600', letterSpacing: -0.6, color: '#202D25', textAlign: 'center' },
  description: { color: '#656D66', textAlign: 'center' },
  nearbySection: { width: '100%', alignItems: 'center', gap: 10 },
  nearbyMessage: { color: '#202D25', fontWeight: '400', fontStyle: 'normal', textAlign: 'center' },
  nearbyFound: { color: '#253D2F', fontWeight: '600' },
  footer: { flexShrink: 0 },
  previewNote: { fontSize: 12, lineHeight: 18, color: '#656D66', textAlign: 'center' },
  button: { borderRadius: 16, backgroundColor: '#253D2F', paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { fontSize: 14, fontWeight: '700', letterSpacing: 1.5, color: '#FFFFFF' },
  pressed: { opacity: 0.7 },
});
