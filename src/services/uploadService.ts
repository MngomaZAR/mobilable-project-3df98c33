import { supabase } from '../config/supabaseClient';
import { BUCKETS } from '../config/environment';
import * as ImageManipulator from 'expo-image-manipulator';
import { Result, success, failure } from '../utils/result';
import { uid } from '../utils/id';

const PUBLIC_BUCKETS = new Set<string>([BUCKETS.avatars]);
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const STORAGE_REF_SEPARATOR = '::';

export const buildStorageRef = (bucket: string, path: string) => `${bucket}${STORAGE_REF_SEPARATOR}${path}`;

export const parseStorageRef = (value: string) => {
  const idx = value.indexOf(STORAGE_REF_SEPARATOR);
  if (idx <= 0) return null;
  return { bucket: value.slice(0, idx), path: value.slice(idx + STORAGE_REF_SEPARATOR.length) };
};

export const isStorageRef = (value: string) => value.includes(STORAGE_REF_SEPARATOR);

const getReadableUrl = async (bucket: string, path: string): Promise<string> => {
  if (PUBLIC_BUCKETS.has(bucket)) {
    return supabase.storage.from(bucket as any).getPublicUrl(path).data.publicUrl;
  }
  const { data, error } = await supabase.storage.from(bucket as any).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Unable to generate signed URL.');
  }
  return data.signedUrl;
};

export const resolveStorageRef = async (value: string, fallbackBucket?: string): Promise<string> => {
  if (!value) return value;
  if (/^https?:\/\//i.test(value)) return value;

  const parsed = parseStorageRef(value);
  if (parsed) return await getReadableUrl(parsed.bucket, parsed.path);

  if (fallbackBucket) return await getReadableUrl(fallbackBucket, value);
  return value;
};

/**
 * Uploads an image to Supabase Storage and returns the public URL.
 * Includes automatic compression and resizing.
 */
export const uploadImage = async (
  uri: string,
  bucket: string = BUCKETS.posts,
  options?: { returnStorageRef?: boolean }
): Promise<string> => {
  try {
    const manipulated = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1200 } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
    );

    const response = await fetch(manipulated.uri);
    const blob = await response.blob();
    
    if (blob.size > 5 * 1024 * 1024) {
      throw new Error('Image must be under 5MB.');
    }

    const fileName = `${uid()}-${Date.now()}.jpg`;
    const filePath = `uploads/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from(bucket as any)
      .upload(filePath, blob, { contentType: 'image/jpeg', upsert: false });

    if (uploadError) throw uploadError;

    if (options?.returnStorageRef) {
      return buildStorageRef(bucket, filePath);
    }
    return await getReadableUrl(bucket, filePath);
  } catch (error: any) {
    console.error(`Upload error for bucket "${bucket}":`, error);
    if (error.message?.toLowerCase().includes('bucket not found')) {
      throw new Error(`Storage bucket "${bucket}" not found. Please create it in your Supabase dashboard.`);
    }
    throw new Error(error.message || 'Image upload failed');
  }
};

/**
 * Uploads an avatar image for a specific user.
 * Uses uid-scoped path ({userId}/avatar.jpg) with upsert so it always replaces
 * the existing avatar rather than creating duplicate files.
 * Returns the public URL (avatars bucket is public — no signed URL needed).
 */
export const uploadAvatar = async (uri: string, userId: string): Promise<string> => {
  const manipulated = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 400 } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
  );
  const blob = await (await fetch(manipulated.uri)).blob();
  const { error } = await supabase.storage
    .from(BUCKETS.avatars)
    .upload(`${userId}/avatar.jpg`, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(error.message || 'Avatar upload failed');
  return supabase.storage.from(BUCKETS.avatars).getPublicUrl(`${userId}/avatar.jpg`).data.publicUrl;
};

/**
 * Generates a blurred low-res preview for locked content.
 */
export const uploadBlurredPreview = async (uri: string): Promise<Result<string>> => {
  try {
    const manipulated = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 100 } }],
      { compress: 0.2, format: ImageManipulator.SaveFormat.JPEG }
    );
    const ref = await uploadImage(manipulated.uri, BUCKETS.previews, { returnStorageRef: true });
    return success(ref);
  } catch (err: any) {
    return failure(err);
  }
};

/**
 * Uploads a premium media asset and registers it in the media_assets table.
 * bookingId is required — media_assets.booking_id is NOT NULL in the DB schema.
 */
export const uploadMediaAsset = async (uri: string, ownerId: string, bookingId: string | null, priceZar?: number | null, title?: string | null): Promise<Result<any>> => {
  try {
    if (!bookingId) throw new Error('bookingId is required for media_assets upload.');

    const manipulated = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1200 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
    );

    const blob = await (await fetch(manipulated.uri)).blob();
    // Path: {ownerId}/{bookingId}/{timestamp}.jpg — matches backend spec
    const fileName = `${ownerId}/${bookingId}/${Date.now()}.jpg`;
    
    // Upload to the 'media' bucket (not 'media_assets' — that doesn't exist)
    const { error: uploadError } = await supabase.storage
      .from(BUCKETS.media)
      .upload(fileName, blob, { contentType: 'image/jpeg' });

    if (uploadError) throw uploadError;

    // Generate a blurred low-res preview for locked content display
    const previewRes = await uploadBlurredPreview(uri);
    const previewUrl = previewRes.success ? previewRes.data : '';

    // Register asset in DB — bucket column must match actual bucket name
    const { data, error: dbError } = await supabase
      .from('media_assets')
      .insert({
        owner_id: ownerId,
        booking_id: bookingId,
        bucket: BUCKETS.media,
        object_path: fileName,
        mime_type: 'image/jpeg',
        is_locked: (priceZar ?? 0) > 0,
        price_zar: priceZar,
        title,
        preview_url: previewUrl
      })
      .select()
      .single();

    if (dbError) throw dbError;
    return success(data);
  } catch (error: any) {
    return failure(error);
  }
};
