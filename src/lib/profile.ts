import { PHOTO_SIZE_ERROR, PHOTO_TYPE_ERROR, PHOTO_UPLOAD_ERROR } from './profile-photo';
import { saveSelectedPhotos, type PhotoSelections } from './profile-photos';

export const PROFILE_INTENTS = ['Dating', 'Friendship', 'Networking', 'Socializing'] as const;
export type ProfileIntention = (typeof PROFILE_INTENTS)[number];
export type ProfileDraft = {
  firstName: string;
  dateOfBirth: string;
  gender: string;
  bio: string;
  intents: ProfileIntention[];
  photos?: PhotoSelections;
  photoOwner?: string;
};
export const emptyProfileDraft: ProfileDraft = { firstName: '', dateOfBirth: '', gender: '', bio: '', intents: [] };

export function validateProfile(draft: ProfileDraft, requireIntents = true): string | null {
  if (!draft.firstName.trim()) return 'Please enter your first name.';
  if ([...draft.firstName.trim()].length > 60) return 'Please keep your first name within 60 characters.';
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(draft.dateOfBirth);
  if (!match) return 'Please enter your date of birth as MM/DD/YYYY.';
  const [, month, day, year] = match.map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day || date.getTime() >= today) {
    return 'Please enter a valid date of birth in the past.';
  }
  if ([...draft.gender].length > 60) return 'Please keep your gender description within 60 characters.';
  if ([...draft.bio].length > 200) return 'Please keep your bio within 200 characters.';
  if (draft.intents.length > 4 || new Set(draft.intents).size !== draft.intents.length ||
    draft.intents.some((intent) => !PROFILE_INTENTS.includes(intent))) {
    return 'Please choose from the listed connection options.';
  }
  if (requireIntents && !draft.intents.length) return 'Please choose at least one connection option.';
  return null;
}

export async function saveProfile(draft: ProfileDraft, editing = false): Promise<void> {
  const validation = validateProfile(draft, !editing);
  if (validation) throw new Error(validation);
  const { supabase } = await import('./supabase');
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) throw new Error('Please log in again before saving your profile.');
  if (draft.photoOwner && draft.photoOwner !== data.user.id) throw new Error('Please log in again before saving your profile.');
  try {
    await saveSelectedPhotos(data.user.id, draft.photos ?? {});
  } catch (failure) {
    if (failure instanceof Error && [PHOTO_SIZE_ERROR, PHOTO_TYPE_ERROR].includes(failure.message)) throw failure;
    throw new Error(PHOTO_UPLOAD_ERROR);
  }
  const [month, day, year] = draft.dateOfBirth.split('/');
  const values = {
    user_id: data.user.id,
    first_name: draft.firstName.trim(),
    date_of_birth: `${year}-${month}-${day}`,
    gender: draft.gender.trim() || null,
    bio: draft.bio.trim() || null,
    // Profile information only; never used as discovery filters.
    intents: draft.intents,
  };
  const { error } = editing
    ? await supabase.from('profiles').update(values).eq('user_id', data.user.id).select('user_id').single()
    : await supabase.from('profiles').upsert(values, { onConflict: 'user_id' });
  if (error) throw new Error('We could not save your profile. Please try again in a moment.');
}

export function profileSaveError(error: unknown): string {
  if (error instanceof Error && [PHOTO_UPLOAD_ERROR, PHOTO_SIZE_ERROR, PHOTO_TYPE_ERROR].includes(error.message)) return error.message;
  // Never display raw Supabase/import/network errors or private data.
  if (error instanceof Error && error.message === 'Please log in again before saving your profile.') return error.message;
  return 'We could not save your profile. Please check your connection and try again.';
}
