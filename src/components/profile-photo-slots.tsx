import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import { useFocusEffect } from 'expo-router';
import { useOnboarding } from './onboarding-provider';
import { validatePhoto } from '@/lib/profile-photo';
import { ownPhotoPreviews, photoUser, PHOTO_POSITIONS, reconcilePhotos, removeOwnPhoto, type PhotoPosition } from '@/lib/profile-photos';

export function ProfilePhotoSlots({ onBusy, editing = false }: { onBusy: (busy: boolean) => void; editing?: boolean }) {
  const { draft, setDraft } = useOnboarding();
  const [remote, setRemote] = useState<PhotoPosition[]>([]);
  const [previews, setPreviews] = useState<Partial<Record<PhotoPosition, string>>>({});
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const mounted = useRef(false);
  const owner = useRef<string | undefined>(undefined);

  const load = useCallback(async () => {
    if (locked.current) return;
    locked.current = true;
    try {
      const userId = await photoUser();
      const positions = await reconcilePhotos(userId);
      const urls = await ownPhotoPreviews(userId, positions);
      if (!mounted.current || await photoUser() !== userId) return;
      owner.current = userId;
      setDraft((previous) => ({ ...previous, photoOwner: userId,
        photos: previous.photoOwner === userId ? previous.photos : {} }));
      setRemote(positions);
      setPreviews(urls);
      setReady(true);
      setError(positions.some((position) => !urls[position]) ? 'Some previews could not load. Tap Refresh photos to retry.' : '');
    } catch {
      if (mounted.current) setError('We could not load your photos. Please retry before making photo changes.');
    } finally { locked.current = false; }
  }, [setDraft]);

  useFocusEffect(useCallback(() => {
    mounted.current = true;
    const initial = setTimeout(() => void load(), 0);
    // Renew display-only URLs before their ten-minute expiry.
    const timer = setInterval(() => void load(), 8 * 60 * 1000);
    return () => { mounted.current = false; clearTimeout(initial); clearInterval(timer); };
  }, [load]));
  useEffect(() => { onBusy(busy || !ready); }, [busy, ready, onBusy]);

  async function choose(position: PhotoPosition) {
    if (locked.current || !ready) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], allowsMultipleSelection: false, allowsEditing: false, quality: 1,
      });
      if (result.canceled || !mounted.current) return;
      const asset = result.assets[0];
      const validation = validatePhoto(asset);
      if (validation) { setError(validation); return; }
      if (await photoUser() !== owner.current) throw new Error('Account changed');
      setDraft((previous) => ({ ...previous, photos: { ...previous.photos, [position]: {
        uri: asset.uri, file: asset.file, fileSize: asset.fileSize, mimeType: asset.mimeType,
      } } }));
    } catch (failure) {
      const code = typeof failure === 'object' && failure !== null && 'code' in failure ? String(failure.code) : '';
      if (mounted.current) setError(/permission|denied|unauthorized/i.test(code)
        ? 'Please allow photo access in your device settings to choose a photo.'
        : 'We could not select that photo. Please try again.');
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  }

  async function remove(position: PhotoPosition) {
    if (locked.current || !ready || !owner.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      // A prior FINISH attempt may have uploaded this slot before failing.
      // Always reconcile deletion with Storage, even for a local selection.
      await removeOwnPhoto(owner.current, position);
      if (!mounted.current) return;
      setRemote((previous) => previous.filter((item) => item !== position));
      setDraft((previous) => {
        const photos = { ...previous.photos };
        delete photos[position];
        return { ...previous, photos };
      });
    } catch {
      if (mounted.current) setError('Photo removal did not finish. Please try removing it again.');
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  }

  return <View style={styles.section}>
    <Text style={styles.label}>Photos</Text>
    <View style={styles.row}>{PHOTO_POSITIONS.map((position) => {
      const selected = draft.photos?.[position];
      const exists = !!selected || remote.includes(position);
      const uri = selected?.uri ?? (remote.includes(position) ? previews[position] : undefined);
      return <View key={position} style={styles.slot}>
        {!editing && <Text style={styles.label}>{position === 1 ? '1 · Primary' : `Slot ${position}`}</Text>}
        <View>
        <Pressable disabled={busy || !ready} accessibilityRole="button"
          accessibilityLabel={`${exists ? 'Replace' : 'Add'} photo in slot ${position}${position === 1 ? ', Primary' : ''}`}
          onPress={() => void choose(position)} style={styles.tile}>
          {uri ? <Image source={{ uri }} style={styles.image} resizeMode="cover" accessibilityLabel={`Photo ${position}`}
            onError={() => setError('A preview could not load. Tap Refresh photos to retry.')} />
            : <Text style={styles.placeholder}>{exists ? 'Photo saved' : editing ? '+ Add' : '+'}</Text>}
          {editing && position === 1 && <View pointerEvents="none" style={styles.primaryBadge}>
            <Text style={styles.primaryLabel}>PRIMARY</Text>
          </View>}
        </Pressable>
        {editing && exists && <Pressable disabled={busy || !ready} accessibilityRole="button"
          accessibilityLabel={`Remove photo ${position}`} accessibilityState={{ disabled: busy || !ready }}
          onPress={() => void remove(position)} style={styles.removeTarget}>
          <View style={styles.removeCircle}><SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={14} tintColor="#253D2F" /></View>
        </Pressable>}
        </View>
        {!editing && <Pressable disabled={busy || !ready} accessibilityRole="button" onPress={() => void choose(position)} style={styles.action}>
          <Text style={styles.actionText}>{exists ? 'Replace' : 'Add photo'}</Text>
        </Pressable>}
        {!editing && exists && <Pressable disabled={busy || !ready} accessibilityRole="button" accessibilityLabel={`Remove photo ${position}`}
          onPress={() => void remove(position)} style={styles.action}><Text style={styles.hint}>Remove</Text></Pressable>}
      </View>;
    })}</View>
    {!editing && <Text style={styles.hint}>Optional. Up to 3 photos, 5 MiB each. JPEG, PNG or WebP. Slot 1 is always Primary.</Text>}
    {!editing && <Text style={styles.hint}>New photos save when you finish your profile. Removing a saved photo takes effect now.</Text>}
    {busy && <Text style={styles.hint}>Updating photos...</Text>}
    {!ready && !error && <Text style={styles.hint}>Loading photos...</Text>}
    {!!error && <Text accessibilityRole="alert" style={styles.hint}>{error}</Text>}
    {(!editing || !!error) && <Pressable disabled={busy} accessibilityRole="button" onPress={() => void load()} style={styles.action}>
      <Text style={styles.actionText}>Refresh photos</Text>
    </Pressable>}
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: 8 }, row: { flexDirection: 'row', gap: 10 }, slot: { flex: 1, minWidth: 0, gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: '#202D25' },
  tile: { width: '100%', aspectRatio: 0.8, borderRadius: 12, borderWidth: 1, borderColor: '#C9CEC7', backgroundColor: '#E8EBE5', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' }, placeholder: { color: '#656D66', fontSize: 18, textAlign: 'center' },
  action: { minHeight: 44, justifyContent: 'center' }, actionText: { color: '#253D2F', fontSize: 13, fontWeight: '600' },
  hint: { color: '#656D66', fontSize: 12, lineHeight: 18 },
  primaryBadge: { position: 'absolute', bottom: 6, left: 6, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 3, backgroundColor: 'rgba(254, 252, 248, 0.92)' },
  primaryLabel: { color: '#253D2F', fontSize: 9, fontWeight: '600', letterSpacing: 0.5 },
  removeTarget: { position: 'absolute', top: 0, right: 0, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  removeCircle: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#FEFCF8', borderWidth: 1, borderColor: '#C9CEC7', alignItems: 'center', justifyContent: 'center' },
});
