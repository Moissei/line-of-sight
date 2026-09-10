import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useState } from 'react';
import type { NearbyProfile } from '@/lib/nearby-discovery';
import { RequestToConnect } from './request-to-connect';

function PrimaryPhoto({ uri }: { uri?: string }) {
  const [failed, setFailed] = useState(false);
  return <View style={styles.photo}>
    <View style={styles.avatar} accessible={false}>
      <View style={styles.avatarHead} /><View style={styles.avatarShoulders} />
    </View>
    {!!uri && !failed && <Image source={{ uri }} style={StyleSheet.absoluteFill}
      contentFit="cover" cachePolicy="none" accessibilityLabel="Primary profile photo"
      onError={() => setFailed(true)} />}
  </View>;
}

export function NearbyProfileCard({ profile }: { profile: NearbyProfile }) {
  return (
    <View style={styles.card}>
      <PrimaryPhoto key={profile.primaryPhotoUrl ?? 'placeholder'} uri={profile.primaryPhotoUrl} />
      <View style={styles.header}>
        <View style={styles.identity}>
          <Text style={styles.name}>{profile.first_name}{profile.age !== null ? `, ${profile.age}` : ''}</Text>
          {!!profile.gender?.trim() && <Text style={styles.secondary}>{profile.gender}</Text>}
        </View>
      </View>
      {!!profile.bio?.trim() && <Text style={styles.bio}>{profile.bio}</Text>}
      {profile.intents.length > 0 && (
        <View style={styles.intents}>
          {profile.intents.map((intent, index) => (
            <View key={`${intent}-${index}`} style={styles.chip}><Text style={styles.intentLabel}>{intent}</Text></View>
          ))}
        </View>
      )}
      {__DEV__ && <Text style={styles.distance}>{profile.distance_meters} m away</Text>}
      <RequestToConnect key={profile.user_id} targetUserId={profile.user_id} revision={profile.requestRevision ?? 0} />
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', aspectRatio: 1.4, borderRadius: 12, overflow: 'hidden', backgroundColor: '#EBEEE7', alignItems: 'center', justifyContent: 'center' },
  card: { width: '100%', borderWidth: 1, borderColor: '#C9CEC7', borderRadius: 16, padding: 18, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#EBEEE7', alignItems: 'center', justifyContent: 'center', gap: 3, flexShrink: 0 },
  avatarHead: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#8B988D' },
  avatarShoulders: { width: 24, height: 13, borderTopLeftRadius: 12, borderTopRightRadius: 12, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, backgroundColor: '#8B988D' },
  identity: { flex: 1, minWidth: 0, gap: 4 },
  name: { fontSize: 22, lineHeight: 28, fontWeight: '600', color: '#202D25' },
  secondary: { fontSize: 14, lineHeight: 20, color: '#656D66' },
  bio: { fontSize: 15, lineHeight: 23, color: '#202D25' },
  intents: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: '#EBEEE7' },
  intentLabel: { fontSize: 12, lineHeight: 18, color: '#253D2F' },
  distance: { fontSize: 12, lineHeight: 18, color: '#656D66' },
});
