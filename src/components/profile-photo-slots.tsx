import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import { useFocusEffect } from 'expo-router';
import { useOnboarding } from './onboarding-provider';
import { stagePhotos } from '@/lib/profile-photo-draft';
import { readEditorPhotos, photoUser, PHOTO_POSITIONS, type PhotoPosition } from '@/lib/profile-photos';

export function ProfilePhotoSlots({ onBusy, editing = false }: { onBusy: (busy: boolean) => void; editing?: boolean }) {
  const { draft, setDraft } = useOnboarding();
  const [remote, setRemote] = useState<PhotoPosition[]>([]);
  const [previews, setPreviews] = useState<Partial<Record<PhotoPosition, string>>>({});
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const owner = useRef<string | undefined>(undefined);

  const load = useCallback(async function loadPhotos() {
    if (locked.current) return;
    locked.current = true;
    const currentGeneration = generation.current;
    try {
      const userId = await photoUser();
      const { positions, previews: urls } = await readEditorPhotos(userId);
      const currentOwner = await photoUser();
      if (!mounted.current || generation.current !== currentGeneration || currentOwner !== userId) return;
      owner.current = userId;
      setDraft((previous) => ({ ...previous, photoOwner: userId,
        photos: previous.photoOwner === userId ? previous.photos : {} }));
      setRemote(positions);
      setPreviews(urls);
      setReady(true);
      setError(positions.some((position) => !urls[position]) ? 'Some previews could not load. Tap Refresh photos to retry.' : '');
    } catch {
      if (mounted.current && generation.current === currentGeneration) setError('We could not load your photos. Please retry before making photo changes.');
    } finally {
      locked.current = false;
      if (mounted.current && generation.current !== currentGeneration) void loadPhotos();
    }
  }, [setDraft]);

  useFocusEffect(useCallback(() => {
    mounted.current = true;
    generation.current++;
    setReady(false);
    if (editing) setDraft(previous => ({ ...previous, photos: {} }));
    const initial = setTimeout(() => void load(), 0);
    // Renew display-only URLs before their ten-minute expiry.
    const timer = setInterval(() => void load(), 8 * 60 * 1000);
    return () => { mounted.current = false; generation.current++; clearTimeout(initial); clearInterval(timer); };
  }, [load, editing, setDraft]));
  useEffect(() => { onBusy(busy || !ready); }, [busy, ready, onBusy]);

  async function choose(position?: PhotoPosition, fillEmpty = false) {
    if (locked.current || !ready) return;
    const destinations = fillEmpty ? PHOTO_POSITIONS.filter(slot => {
      const operation = draft.photos?.[slot];
      return operation?.kind === 'remove' || (operation?.kind !== 'replace' && !remote.includes(slot));
    }) : position === undefined ? PHOTO_POSITIONS : [position];
    if (!destinations.length) return;
    locked.current = true;
    setBusy(true);
    setError('');
    const currentGeneration = generation.current;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], allowsMultipleSelection: fillEmpty || position === undefined,
        selectionLimit: destinations.length, orderedSelection: true, allowsEditing: false, quality: 1,
      });
      if (result.canceled || !mounted.current || generation.current !== currentGeneration) return;
      let selections;
      try { selections = stagePhotos({}, result.assets, destinations); }
      catch (failure) {
        setError(failure instanceof Error ? failure.message : 'We could not select that photo. Please try again.');
        return;
      }
      if (await photoUser() !== owner.current) throw new Error('Account changed');
      if (!mounted.current || generation.current !== currentGeneration) return;
      setDraft(previous => ({ ...previous, photos: { ...previous.photos, ...selections } }));
    } catch (failure) {
      const code = typeof failure === 'object' && failure !== null && 'code' in failure ? String(failure.code) : '';
      if (mounted.current && generation.current === currentGeneration) setError(/permission|denied|unauthorized/i.test(code)
        ? 'Please allow photo access in your device settings to choose a photo.'
        : 'We could not select that photo. Please try again.');
    } finally {
      locked.current = false;
      if (mounted.current) {
        setBusy(false);
        if (generation.current !== currentGeneration) void load();
      }
    }
  }

  function remove(position: PhotoPosition) {
    if (locked.current || !ready || !owner.current) return;
    setDraft(previous => ({ ...previous, photos: { ...previous.photos, [position]: { kind: 'remove' } } }));
  }

  return <View style={styles.section}>
    <Text style={styles.label}>Photos</Text>
    <View style={styles.row}>{PHOTO_POSITIONS.map((position) => {
      const operation = draft.photos?.[position];
      const selected = operation?.kind === 'replace' ? operation.photo : undefined;
      const exists = operation?.kind !== 'remove' && (!!selected || remote.includes(position));
      const uri = exists ? selected?.uri ?? previews[position] : undefined;
      return <View key={position} style={styles.slot}>
        <View>
        <Pressable disabled={busy || !ready} accessibilityRole="button"
          accessibilityLabel={`${exists ? 'Replace' : 'Add'} photo in slot ${position}${position === 1 ? ', Primary' : ''}`}
          onPress={() => void choose(position, !exists)} style={styles.tile}>
          {uri ? <Image source={{ uri }} style={styles.image} resizeMode="cover" accessibilityLabel={`Photo ${position}`}
            onError={() => setError('A preview could not load. Tap Refresh photos to retry.')} />
            : <Text style={styles.placeholder}>{exists ? 'Photo saved' : '+ Add'}</Text>}
          {exists && position === 1 && <View pointerEvents="none" style={styles.primaryBadge}>
            <Text style={styles.primaryLabel}>PRIMARY</Text>
          </View>}
        </Pressable>
        {exists && <Pressable disabled={busy || !ready} accessibilityRole="button"
          accessibilityLabel={`Remove photo ${position}`} accessibilityState={{ disabled: busy || !ready }}
          onPress={() => void remove(position)} style={styles.removeTarget}>
          <View style={styles.removeCircle}><SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={14} tintColor="#253D2F" /></View>
        </Pressable>}
        </View>
      </View>;
    })}</View>
    <Pressable disabled={busy || !ready} accessibilityRole="button" accessibilityLabel="Add/Replace Photos"
      accessibilityState={{ disabled: busy || !ready }} onPress={() => void choose()} style={styles.action}>
      <Text style={styles.actionText}>Add/Replace Photos</Text>
    </Pressable>
    {busy && <Text style={styles.hint}>Updating photos...</Text>}
    {!ready && !error && <Text style={styles.hint}>Loading photos...</Text>}
    {!!error && <Text accessibilityRole="alert" style={styles.hint}>{error}</Text>}
    {!!error && <Pressable disabled={busy} accessibilityRole="button" onPress={() => void load()} style={styles.action}>
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
