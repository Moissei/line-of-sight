import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Animated, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProfileStatus } from '@/components/profile-status-provider';
import { ownPhotoPreviews, photoUser, PHOTO_POSITIONS, type PhotoPosition } from '@/lib/profile-photos';
import { PROFILE_INTENTS } from '@/lib/profile';
import { supabase } from '@/lib/supabase';

type Profile = { first_name: string; date_of_birth: string; gender: string | null; bio: string | null; intents: string[] };
export function profileAge(dob: string, today = new Date()) {
  const [year, month, day] = dob.split('-').map(Number);
  if (!year || !month || !day) return null;
  return today.getFullYear() - year - (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day) ? 1 : 0);
}
export default function YourProfileScreen() {
  const router = useRouter();
  const { refresh } = useProfileStatus();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [photos, setPhotos] = useState<Partial<Record<PhotoPosition, string>>>({});
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useFocusEffect(useCallback(() => {
    void attempt; // Restart the focus load when the user retries.
    let cancelled = false;
    let inFlight = false;
    const abort = new AbortController();
    async function load() {
      if (cancelled || inFlight) return;
      inFlight = true;
      setError(false);
      try {
        const owner = await photoUser();
        if (cancelled) return;
        const { data, error: failure } = await supabase.from('profiles').select('first_name,date_of_birth,gender,bio,intents').eq('user_id', owner).abortSignal(abort.signal).maybeSingle();
        if (cancelled) return;
        if (failure) throw new Error('Unavailable');
        if (!data) { await refresh(); return; }
        const previews = await ownPhotoPreviews(owner, [...PHOTO_POSITIONS]);
        const currentOwner = await photoUser();
        if (cancelled || currentOwner !== owner) return;
        setProfile(data); setPhotos(previews);
      } catch { if (!cancelled) setError(true); }
      finally { inFlight = false; }
    }
    void load();
    // Renew the existing ten-minute signed previews while this tab is visible.
    const timer = setInterval(() => void load(), 8 * 60 * 1000);
    // Keep the presentation on ordinary blur. The root's keyed auth provider
    // unmounts this screen (and its retained state) on logout/account changes.
    return () => { cancelled = true; abort.abort(); clearInterval(timer); };
  }, [attempt, refresh]));
  const age = profile ? profileAge(profile.date_of_birth) : null;
  const failedPhoto = (position: PhotoPosition) => setPhotos(current => { const next = { ...current }; delete next[position]; return next; });
  return <SafeAreaView edges={['top', 'left', 'right']} style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.headerLabel}>Profile</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Account" style={styles.gear} onPress={() => router.push('/account')}>
          <Text style={styles.accountText}>Account</Text>
        </Pressable>
      </View>
      <Text style={styles.subtitle}>Your presence on Line of Sight.</Text>
      {error && <View><Text accessibilityRole="alert" style={styles.body}>We could not load your profile. Please try again.</Text><Pressable accessibilityRole="button" style={styles.gear} onPress={() => setAttempt(value => value + 1)}><Text style={styles.body}>Try again</Text></Pressable></View>}
      {!profile && !error && <Text style={styles.body}>Loading your profile...</Text>}
      {profile && <>
        <ProfilePhotoPager photos={photos} onFailure={failedPhoto} />
        <View style={styles.detailsCard}>
        <View style={styles.identity}>
          <Text style={styles.name}>{profile.first_name}{age !== null ? `, ${age}` : ''}</Text>
          {!!profile.gender && <Text style={styles.body}>{(profile.gender === 'Male' || profile.gender === 'Female') && <Text style={styles.genderSymbol}>{profile.gender === 'Male' ? '\u2642' : '\u2640'} </Text>}{profile.gender}</Text>}
        </View>
        <View style={styles.chips}>{PROFILE_INTENTS.filter(intent => profile.intents?.includes(intent)).map(intent => <Text key={intent} style={styles.chip}>{intent}</Text>)}</View>
        <View style={styles.detailsDivider} />
        <View style={styles.glimpse}><Text style={styles.sectionTitle}>A glimpse</Text><Text style={styles.body}>{profile.bio?.trim() || 'Add a glimpse of yourself'}</Text></View>
        </View>
        <Pressable accessibilityRole="button" style={({ pressed }) => [styles.edit, pressed && { opacity: 0.75 }]} onPress={() => router.push('/edit-profile')}><Text style={styles.editText}>EDIT PROFILE</Text></Pressable>
      </>}
    </ScrollView>
  </SafeAreaView>;
}
export function ProfilePhotoPager({ photos, onFailure }: { photos: Partial<Record<PhotoPosition, string>>; onFailure: (position: PhotoPosition) => void }) {
  const positions = PHOTO_POSITIONS.filter(position => photos[position]);
  const [width, setWidth] = useState(0);
  const [foreground, setForeground] = useState(0);
  const [offset] = useState(() => new Animated.Value(0));
  const scroll = useRef<ScrollView>(null);
  const page = useRef(0);
  const cardWidth = width;
  const step = cardWidth + 18;
  useEffect(() => {
    page.current = Math.min(page.current, Math.max(0, positions.length - 1));
    scroll.current?.scrollTo({ x: page.current * step, animated: false });
  }, [step, positions.length]);
  return <View style={styles.photoGroup} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    {positions.length ? <Animated.ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false}
      scrollEnabled={positions.length > 1} snapToInterval={step} decelerationRate="fast" disableIntervalMomentum
      contentContainerStyle={{ paddingHorizontal: (width - cardWidth) / 2, gap: 18, alignItems: 'center' }}
      style={{ height: cardWidth / 0.9 }} scrollEventThrottle={16}
      onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: offset } } }], { useNativeDriver: true, listener: (event: { nativeEvent: { contentOffset: { x: number } } }) => setForeground(Math.max(0, Math.min(positions.length - 1, Math.round(event.nativeEvent.contentOffset.x / step)))) })}
      onMomentumScrollEnd={event => { page.current = Math.max(0, Math.min(positions.length - 1, Math.round(event.nativeEvent.contentOffset.x / step))); }}>
      {positions.map((position) => <Animated.View key={position} style={[styles.carouselCard, {
        width: cardWidth,
      }]}>
        <Image source={{ uri: photos[position] }} accessibilityLabel="Your profile photo" style={styles.image} resizeMode="cover" onError={() => onFailure(position)} />
      </Animated.View>)}
    </Animated.ScrollView> : <View style={[styles.carouselCard, { width: '100%', alignSelf: 'center' }]}><SymbolView name={{ ios: 'person', android: 'person_outline', web: 'person_outline' }} size={64} tintColor="#8B988D" accessible={false} /></View>}
    {positions.length > 1 && <View style={styles.dots} accessible accessibilityLabel={`Photo ${Math.min(foreground, positions.length - 1) + 1} of ${positions.length}`}>
      {positions.map((position, index) => <View key={position} style={[styles.dot, index === Math.min(foreground, positions.length - 1) && styles.activeDot]} />)}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FEFCF8' },
  content: { width: '100%', maxWidth: 460, alignSelf: 'center', paddingHorizontal: 28, paddingTop: 12, paddingBottom: 36, gap: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',  },
  gear: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  headerLabel: { flex: 1, fontSize: 28, fontWeight: '600', color: '#253D2F' },
  accountText: { fontSize: 14, fontWeight: '500', color: '#253D2F' },
  subtitle: { fontSize: 15, lineHeight: 22, color: '#656D66', marginTop: -16 },
  photoGroup: { width: '78.4%', maxWidth: 282, alignSelf: 'center', marginTop: 14 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#CDD2CB' },
  activeDot: { backgroundColor: '#253D2F' },
  carouselCard: { aspectRatio: 9 / 10, borderRadius: 15, overflow: 'hidden', backgroundColor: '#EBEEE7', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  detailsCard: { borderWidth: 1, borderColor: '#D6DCD4', borderRadius: 18, padding: 18, gap: 18, backgroundColor: '#FEFCF8' },
  detailsDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#D6DCD4' },
  genderSymbol: { fontSize: 20, lineHeight: 25 },
  identity: { gap: 6 },
  name: { fontSize: 28, fontWeight: '600', color: '#202D25' }, body: { fontSize: 15, lineHeight: 23, color: '#656D66' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, chip: { maxWidth: '100%', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: '#253D2F', color: '#FEFCF8', fontSize: 12, lineHeight: 17 },
  glimpse: { gap: 8 }, sectionTitle: { fontSize: 17, fontWeight: '600', color: '#253D2F' },
  edit: { minHeight: 58, padding: 18, borderRadius: 16, backgroundColor: '#253D2F', alignItems: 'center', justifyContent: 'center', marginTop: -8 },
  editText: { color: '#FEFCF8', fontSize: 14, fontWeight: '700', letterSpacing: 1.5 },
});
