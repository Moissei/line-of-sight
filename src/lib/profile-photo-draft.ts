import { validatePhoto, type ProfilePhoto } from './profile-photo';
import { PHOTO_POSITIONS, type PhotoPosition, type PhotoSelections } from './profile-photos';

export function stagePhotos(previous: PhotoSelections, assets: ProfilePhoto[], destinations: readonly PhotoPosition[] = PHOTO_POSITIONS): PhotoSelections {
  if (!assets.length || assets.length > destinations.length) throw new Error('Please choose up to three photos.');
  for (const asset of assets) {
    if (!asset || typeof asset.uri !== 'string' || !asset.uri) throw new Error('We could not select that photo. Please try again.');
    const error = validatePhoto(asset);
    if (error) throw new Error(error);
  }
  const next = { ...previous };
  assets.forEach((asset, index) => {
    next[destinations[index]] = { kind: 'replace', photo: {
      uri: asset.uri, file: asset.file, fileSize: asset.fileSize, mimeType: asset.mimeType,
    } };
  });
  return next;
}
