import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProfileStatus } from '@/components/profile-status-provider';
export default function ProfileGate() {
  const { status, refresh } = useProfileStatus();
  const router = useRouter();
  if (status === 'complete') return <Redirect href="/discovery" />;
  if (status === 'required') return <Redirect href="/create-profile" />;
  return <SafeAreaView style={styles.screen}><View style={styles.content}>
    {status === 'loading' ? <><ActivityIndicator color="#253D2F" /><Text style={styles.text}>Loading your profile...</Text></>
      : <><Text accessibilityRole="alert" style={styles.text}>We could not check your profile. Please try again.</Text>
        <Pressable accessibilityRole="button" style={styles.action} onPress={() => void refresh()}><Text style={styles.link}>Try again</Text></Pressable></>}
    <Pressable accessibilityRole="button" style={styles.action} onPress={() => router.push('/account')}><Text style={styles.link}>Account settings</Text></Pressable>
  </View></SafeAreaView>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#FEFCF8' }, content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 16 }, text: { color: '#656D66', fontSize: 15, textAlign: 'center' }, action: { minHeight: 44, justifyContent: 'center' }, link: { color: '#253D2F', fontSize: 15, fontWeight: '600' } });
