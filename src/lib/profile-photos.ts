import { supabase } from './supabase';
import { readProfilePhoto, type ProfilePhoto } from './profile-photo';

export const PHOTO_POSITIONS = [1, 2, 3] as const;
export type PhotoPosition = (typeof PHOTO_POSITIONS)[number];
export type PhotoSelections = Partial<Record<PhotoPosition, ProfilePhoto>>;
const bucket = () => supabase.storage.from('profile-photos');

export async function photoUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('Photo account unavailable');
  return data.user.id;
}

async function metadata(userId: string, position: PhotoPosition) {
  const { error } = await supabase.from('profile_photos').upsert({
    user_id: userId, position, storage_path: `${userId}/${position}`,
  }, { onConflict: 'user_id,position' });
  if (error) throw new Error('Photo metadata unavailable');
}

// Read-only Storage listing distinguishes absent objects from request failures.
// All paths are derived from the authenticated owner, never from UI input.
export async function reconcilePhotos(userId: string) {
  const { data: profile, error: profileError } = await supabase.from('profiles')
    .select('profile_photo_path').eq('user_id', userId).maybeSingle();
  const { data: rows, error: rowsError } = await supabase.from('profile_photos')
    .select('position,storage_path').eq('user_id', userId);
  if (profileError || rowsError) throw new Error('Photo state unavailable');
  const { data: objects, error } = await bucket().list(userId, { limit: 100 });
  if (error || !objects) throw new Error('Photo listing unavailable');
  const names = new Set(objects.map((object) => object.name));
  if (names.has('profile') && names.has('1')) {
    // Unexpected conflict: preserve both and the legacy reference for recovery.
    throw new Error('Photo migration conflict');
  }
  if (names.has('profile')) {
    const { error: moveError } = await bucket().move(`${userId}/profile`, `${userId}/1`);
    if (moveError) throw new Error('Photo move incomplete');
    names.delete('profile');
    names.add('1');
  }
  // Also repairs upload-success/metadata-failure and move-success/metadata-failure.
  for (const position of PHOTO_POSITIONS) {
    if (names.has(String(position))) await metadata(userId, position);
  }
  if (profile?.profile_photo_path) {
    if (!names.has('1')) throw new Error('Legacy photo requires recovery');
    const { error: clearError } = await supabase.from('profiles')
      .update({ profile_photo_path: null }).eq('user_id', userId)
      .eq('profile_photo_path', `${userId}/profile`);
    if (clearError) throw new Error('Legacy photo cleanup incomplete');
  }
  // Keep stale metadata visible as a recoverable slot; never silently delete it.
  return PHOTO_POSITIONS.filter((position) => names.has(String(position)) ||
    rows?.some((row) => row.position === position));
}

export async function ownPhotoPreviews(userId: string, positions: PhotoPosition[]) {
  const previews: Partial<Record<PhotoPosition, string>> = {};
  for (const position of positions) {
    const { data, error } = await bucket().createSignedUrl(`${userId}/${position}`, 600);
    if (!error && data) previews[position] = data.signedUrl;
  }
  return previews; // In-memory display only. Never written to profile metadata.
}

export async function removeOwnPhoto(expectedUser: string, position: PhotoPosition) {
  const userId = await photoUser();
  if (userId !== expectedUser) throw new Error('Photo account changed');
  const { error } = await bucket().remove([`${userId}/${position}`]);
  if (error) throw new Error('Photo removal incomplete');
  const { error: metadataError } = await supabase.from('profile_photos').delete()
    .eq('user_id', userId).eq('position', position);
  if (metadataError) throw new Error('Photo removal metadata incomplete');
}

export async function saveSelectedPhotos(userId: string, selections: PhotoSelections) {
  await reconcilePhotos(userId);
  for (const position of PHOTO_POSITIONS) {
    const photo = selections[position];
    if (!photo) continue;
    const { body, contentType } = await readProfilePhoto(photo);
    if (await photoUser() !== userId) throw new Error('Photo account changed');
    const { error } = await bucket().upload(`${userId}/${position}`, body, { contentType, upsert: true });
    if (error) throw new Error('Photo upload incomplete');
    await metadata(userId, position);
  }
}
