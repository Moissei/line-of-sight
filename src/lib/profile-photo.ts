import type { ImagePickerAsset } from 'expo-image-picker';
import { Platform } from 'react-native';

export type ProfilePhoto = Pick<ImagePickerAsset, 'uri' | 'file' | 'fileSize' | 'mimeType'>;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_UPLOAD_ERROR = 'We could not upload your photo. Please check your connection and try again.';
export const PHOTO_SIZE_ERROR = 'Please choose a photo no larger than 5 MiB.';
export const PHOTO_TYPE_ERROR = 'Please choose a JPEG, PNG, or WebP photo.';

export function validatePhoto(photo: ProfilePhoto): string | null {
  if ((photo.fileSize ?? photo.file?.size ?? 0) > PHOTO_MAX_BYTES) return PHOTO_SIZE_ERROR;
  // Missing metadata is checked against the actual file bytes before upload.
  if (photo.mimeType && !['image/jpeg', 'image/png', 'image/webp'].includes(photo.mimeType)) return PHOTO_TYPE_ERROR;
  return null;
}

export async function readProfilePhoto(photo: ProfilePhoto) {
  const validation = validatePhoto(photo);
  if (validation) throw new Error(validation);
  let body: ArrayBuffer;
  if (Platform.OS === 'web') {
    if (!photo.file) throw new Error(PHOTO_UPLOAD_ERROR);
    body = await photo.file.arrayBuffer();
  } else {
    const { File } = await import('expo-file-system');
    const file = new File(photo.uri);
    if (file.size > PHOTO_MAX_BYTES) throw new Error(PHOTO_SIZE_ERROR);
    body = await file.arrayBuffer();
  }
  if (body.byteLength > PHOTO_MAX_BYTES) throw new Error(PHOTO_SIZE_ERROR);
  const bytes = new Uint8Array(body);
  const matches = (offset: number, signature: number[]) => signature.every((value, index) => bytes[offset + index] === value);
  const contentType = matches(0, [255, 216, 255]) ? 'image/jpeg'
    : matches(0, [137, 80, 78, 71, 13, 10, 26, 10]) ? 'image/png'
    : matches(0, [82, 73, 70, 70]) && matches(8, [87, 69, 66, 80]) ? 'image/webp' : null;
  if (!contentType) throw new Error(PHOTO_TYPE_ERROR);
  return { body, contentType };
}
