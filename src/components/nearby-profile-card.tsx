import { StyleSheet, Text, View } from 'react-native';
import type { NearbyProfile } from '@/lib/nearby-discovery';

export function NearbyProfileCard({ profile }: { profile: NearbyProfile }) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.avatar} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={styles.avatarHead} />
          <View style={styles.avatarShoulders} />
        </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
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
