import type { ImagePickerAsset } from 'expo-image-picker';
import { Platform } from 'react-native';

export type ProfilePhoto = Pick<ImagePickerAsset, 'uri' | 'file' | 'fileSize' | 'mimeType'>;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_UPLOAD_ERROR = 'We could not upload your photo. Please check your connection and try again.';
export const PHOTO_SIZE_ERROR = 'Please choose a photo no larger than 5 MiB.';
export const PHOTO_TYPE_ERROR = 'Please choose a JPEG, PNG, WebP, HEIC, or HEIF photo.';

export function validatePhoto(photo: ProfilePhoto): string | null {
  if ((photo.fileSize ?? photo.file?.size ?? 0) > PHOTO_MAX_BYTES) return PHOTO_SIZE_ERROR;
  // Input formats differ from uploaded output formats. Decoding must succeed.
  if (photo.mimeType && !['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(photo.mimeType)) return PHOTO_TYPE_ERROR;
  return null;
}

export async function readProfilePhoto(photo: ProfilePhoto) {
  const validation = validatePhoto(photo);
  if (validation) throw new Error(validation);
  const cleanup: (() => void)[] = [];
  let prepared: { body: ArrayBuffer; contentType: string } | undefined;
  let error: Error | undefined;
  try {
    const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
    let input = photo.uri;
    if (Platform.OS === 'web') {
      if (!photo.file) throw new Error(PHOTO_UPLOAD_ERROR);
      input = URL.createObjectURL(photo.file);
      cleanup.push(() => URL.revokeObjectURL(input));
    } else {
      const { File } = await import('expo-file-system');
      if (new File(input).size > PHOTO_MAX_BYTES) throw new Error(PHOTO_SIZE_ERROR);
    }
    const context = ImageManipulator.manipulate(input);
    cleanup.push(() => context.release());
    // Redraw pixels, even without a visual edit. Never copy source file metadata.
    // The native loader normalizes orientation before transformations.
    context.rotate(0);
    const image = await context.renderAsync();
    cleanup.push(() => image.release());
    // The web renderer owns an intermediate blob URL in addition to saveAsync's output.
    if (Platform.OS === 'web' && 'uri' in image && typeof image.uri === 'string' &&
      image.uri.startsWith('blob:') && image.uri !== input && image.uri !== photo.uri) {
      const renderedUri = image.uri;
      cleanup.push(() => URL.revokeObjectURL(renderedUri));
    }
    const jpeg = ['image/jpeg', 'image/heic', 'image/heif'].includes(photo.mimeType ?? photo.file?.type ?? '');
    // PNG is also the conservative choice for unknown input types/alpha channels.
    const result = await image.saveAsync({ format: jpeg ? SaveFormat.JPEG : SaveFormat.PNG, compress: 0.9 });
    if (!result.uri || result.uri === input || result.uri === photo.uri) throw new Error(PHOTO_UPLOAD_ERROR);
    let body: ArrayBuffer;
    if (Platform.OS === 'web') {
      if (!result.uri.startsWith('blob:')) throw new Error(PHOTO_UPLOAD_ERROR);
      cleanup.push(() => URL.revokeObjectURL(result.uri));
      const response = await fetch(result.uri);
      if (!response.ok) throw new Error(PHOTO_UPLOAD_ERROR);
      const blob = await response.blob();
      if (blob.size > PHOTO_MAX_BYTES) throw new Error(PHOTO_SIZE_ERROR);
      body = await blob.arrayBuffer();
    } else {
      const { File } = await import('expo-file-system');
      const output = new File(result.uri);
      cleanup.push(() => { if (output.exists) output.delete(); });
      if (output.size > PHOTO_MAX_BYTES) throw new Error(PHOTO_SIZE_ERROR);
      body = await output.arrayBuffer();
    }
    if (body.byteLength > PHOTO_MAX_BYTES) throw new Error(PHOTO_SIZE_ERROR);
    const bytes = new Uint8Array(body);
    const matches = (signature: number[]) => signature.every((value, index) => bytes[index] === value);
    const contentType = matches([255, 216, 255]) ? 'image/jpeg'
      : matches([137, 80, 78, 71, 13, 10, 26, 10]) ? 'image/png' : null;
    if (contentType !== (jpeg ? 'image/jpeg' : 'image/png')) throw new Error(PHOTO_TYPE_ERROR);
    prepared = { body, contentType };
  } catch (failure) {
    error = failure instanceof Error && [PHOTO_SIZE_ERROR, PHOTO_TYPE_ERROR].includes(failure.message)
      ? failure : new Error(PHOTO_UPLOAD_ERROR);
  }
  for (const dispose of cleanup.reverse()) {
    try { dispose(); } catch { error = new Error(PHOTO_UPLOAD_ERROR); }
  }
  if (error) throw error;
  if (!prepared) throw new Error(PHOTO_UPLOAD_ERROR);
  return prepared;
}
