import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import type { NearbyProfile } from '@/lib/nearby-discovery';
import { SafetyActions } from './safety-actions';
import { RequestToConnect } from './request-to-connect';

function PrimaryPhoto({ uri }: { uri?: string }) {
  const [failed, setFailed] = useState(false);
  const { height } = useWindowDimensions();
  return <View style={[styles.photo, { height: Math.min(190, Math.max(140, height * 0.21)) }]}>
    <View style={styles.avatar} accessible={false}>
      <View style={styles.avatarHead} /><View style={styles.avatarShoulders} />
    </View>
    {!!uri && !failed && <Image source={{ uri }} style={StyleSheet.absoluteFill}
      contentFit="cover" cachePolicy="none" accessibilityLabel="Primary profile photo"
      onError={() => setFailed(true)} />}
  </View>;
}

export function NearbyProfileCard({ profile, sessionAction }: { profile: NearbyProfile; onBlocked?: () => void; sessionAction?: ReactNode }) {
  const { fontScale = 1 } = useWindowDimensions();
  return (
    <View style={styles.card}>
      <PrimaryPhoto key={profile.primaryPhotoUrl ?? 'placeholder'} uri={profile.primaryPhotoUrl} />
      <View style={styles.header}>
        <View style={styles.identity}>
          <Text style={styles.name} accessibilityLabel={[profile.first_name + (profile.age !== null ? ', ' + profile.age : ''), profile.gender?.trim()].filter(Boolean).join(', ')}>
            {profile.first_name}{profile.age !== null ? ', ' + profile.age : ''}
            {!!profile.gender?.trim() && <Text style={[styles.gender, profile.gender.trim().toLowerCase() === 'female' && styles.female, profile.gender.trim().toLowerCase() === 'male' && styles.male]}>{' '}{profile.gender.trim().toLowerCase() === 'female' ? '\u2640\uFE0E' : profile.gender.trim().toLowerCase() === 'male' ? '\u2642\uFE0E' : profile.gender.trim()}</Text>}
          </Text>
        </View>
      </View>
      {!!profile.bio?.trim() && <Text numberOfLines={2} ellipsizeMode="tail" style={styles.bio}>{profile.bio}</Text>}
      {profile.intents.length > 0 && (
        <View style={styles.intents}>
          {profile.intents.map((intent, index) => (
            <View key={`${intent}-${index}`} style={styles.chip}><Text style={styles.intentLabel}>{intent}</Text></View>
          ))}
        </View>
      )}
      <View style={styles.actions}>
      <View style={[styles.actionSlot, { flexBasis: 140 * fontScale }]}>
      <RequestToConnect key={profile.user_id} targetUserId={profile.user_id} revision={profile.requestRevision ?? 0} />
      </View>
      <View style={[styles.actionSlot, { flexBasis: 140 * fontScale }]}>{sessionAction}</View>
      </View>
    </View>
  );
}


export function NearbySafetyOptions({ userId, name, onBlocked }: { userId: string; name?: string; onBlocked: () => void }) {
  return <SafetyActions target={{ kind: 'user', id: userId }} onBlocked={onBlocked} quiet
    trigger={name ? <Text style={styles.safetyLabel}>Safety options for {name}</Text> : undefined} />;
}

const styles = StyleSheet.create({
  safetyLabel: { color: '#656D66', fontSize: 14, fontWeight: '500' },
  photo: { width: '100%', borderRadius: 12, overflow: 'hidden', backgroundColor: '#EBEEE7', alignItems: 'center', justifyContent: 'center' },
  card: { width: '100%', gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#EBEEE7', alignItems: 'center', justifyContent: 'center', gap: 3, flexShrink: 0 },
  avatarHead: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#8B988D' },
  avatarShoulders: { width: 24, height: 13, borderTopLeftRadius: 12, borderTopRightRadius: 12, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, backgroundColor: '#8B988D' },
  identity: { flex: 1, minWidth: 0, gap: 4 },
  name: { fontSize: 22, lineHeight: 28, fontWeight: '600', color: '#202D25' },
  gender: { fontSize: 18, fontWeight: '400', color: '#656D66' },
  female: { fontSize: 20, fontWeight: '500', color: '#B86F7C' },
  male: { fontSize: 20, fontWeight: '500', color: '#647FA3' },
  actionSlot: { flexGrow: 1, flexBasis: 140 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'stretch', justifyContent: 'center', marginTop: 4 },
  bio: { fontSize: 15, lineHeight: 23, color: '#202D25' },
  intents: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#EEF1E9' },
  intentLabel: { fontSize: 12, lineHeight: 18, fontWeight: '500', color: '#253D2F' },
});
