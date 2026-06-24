import { supabase } from '../config/supabaseClient';
import { hasNhost, nhost } from '../config/nhostClient';
import { BUCKETS, environment } from '../config/environment';
import { apiClient } from '../config/apiClient';
import { getApiAccessToken } from '../config/apiSession';
import { backendDb } from './backendGateway';
import * as ImageManipulator from 'expo-image-manipulator';
import { Result, success, failure } from '../utils/result';
import { uid } from '../utils/id';
import { decode } from 'base64-arraybuffer';

const PUBLIC_BUCKETS = new Set<string>([BUCKETS.avatars]);
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const STORAGE_REF_SEPARATOR = '::';
const NHOST_STORAGE_REF_PREFIX = 'nhost::';
const hasApiStorage = environment.backendProvider === 'api';

export const buildStorageRef = (bucket: string, path: string) => `${bucket}${STORAGE_REF_SEPARATOR}${path}`;

export const parseStorageRef = (value: string) => {
  if (value.startsWith(NHOST_STORAGE_REF_PREFIX)) {
    return { bucket: 'nhost', path: value.slice(NHOST_STORAGE_REF_PREFIX.length) };
  }
  const idx = value.indexOf(STORAGE_REF_SEPARATOR);
  if (idx <= 0) return null;
  return { bucket: value.slice(0, idx), path: value.slice(idx + STORAGE_REF_SEPARATOR.length) };
};

export const isStorageRef = (value: string) => value.includes(STORAGE_REF_SEPARATOR);

const getReadableUrl = async (bucket: string, path: string): Promise<string> => {
  if (hasApiStorage) {
    const token = await getApiAccessToken();
    const response = await apiClient.post<{ url: string }>('/storage/signed-url', { bucket, path }, { token });
    if (!response.url) throw new Error('Unable to generate signed URL.');
    return response.url;
  }

  if (bucket === 'nhost' || hasNhost) {
    const { body, status } = await nhost.storage.getFilePresignedURL(path);
    if (status >= 300 || !body?.url) {
      throw new Error('Unable to generate signed URL.');
    }
    return body.url;
  }
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
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );

    if (!manipulated.base64) {
      throw new Error('Could not generate image data');
    }

    // Determine size approximately natively since base64 is ~33% larger
    if (manipulated.base64.length * 0.75 > 5 * 1024 * 1024) {
      throw new Error('Image must be under 5MB.');
    }

    const arrayBuffer = decode(manipulated.base64);
    const fileBlob = new Blob([arrayBuffer], { type: 'image/jpeg' });

    const fileName = `${uid()}-${Date.now()}.jpg`;
    const filePath = `uploads/${fileName}`;

    if (hasApiStorage) {
      const token = await getApiAccessToken();
      const response = await apiClient.post<{ url?: string; path?: string; storageRef?: string }>(
        '/storage/upload',
        {
          bucket,
          path: filePath,
          contentType: 'image/jpeg',
          base64: manipulated.base64,
        },
        { token, timeoutMs: 30000 }
      );
      if (options?.returnStorageRef) {
        return response.storageRef ?? buildStorageRef(bucket, response.path ?? filePath);
      }
      if (response.url) return response.url;
      return await getReadableUrl(bucket, response.path ?? filePath);
    }

    if (hasNhost) {
      const uploadRes = await nhost.storage.uploadFiles({
        'bucket-id': bucket,
        'file[]': [fileBlob],
        'metadata[]': [{ name: fileName }],
      });
      if (uploadRes.status >= 300 || !uploadRes.body?.processedFiles?.[0]?.id) {
        throw new Error('Image upload failed');
      }
      const fileId = uploadRes.body.processedFiles[0].id;
      if (options?.returnStorageRef) {
        return `${NHOST_STORAGE_REF_PREFIX}${fileId}`;
      }
      return await getReadableUrl('nhost', fileId);
    }

    const { error: uploadError } = await supabase.storage
      .from(bucket as any)
      .upload(filePath, arrayBuffer, { contentType: 'image/jpeg', upsert: false });

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
 * Uses a timestamped uploads path to avoid CDN caching issues and
 * ensure the latest avatar is always visible.
 * Returns the public URL (avatars bucket is public - no signed URL needed).
 */
export const uploadAvatar = async (uri: string, userId: string): Promise<string> => {
  const manipulated = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 400 } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );

  if (!manipulated.base64) {
    throw new Error('Could not generate avatar data');
  }

  const arrayBuffer = decode(manipulated.base64);
  const fileBlob = new Blob([arrayBuffer], { type: 'image/jpeg' });

  const filePath = `uploads/${userId}-${Date.now()}.jpg`;
  if (hasApiStorage) {
    const token = await getApiAccessToken();
    const response = await apiClient.post<{ url?: string; path?: string }>(
      '/storage/upload',
      {
        bucket: BUCKETS.avatars,
        path: filePath,
        contentType: 'image/jpeg',
        base64: manipulated.base64,
      },
      { token, timeoutMs: 30000 }
    );
    return response.url ?? (await getReadableUrl(BUCKETS.avatars, response.path ?? filePath));
  }

  if (hasNhost) {
    const uploadRes = await nhost.storage.uploadFiles({
      'bucket-id': BUCKETS.avatars,
      'file[]': [fileBlob],
      'metadata[]': [{ name: `${userId}-${Date.now()}.jpg` }],
    });
    if (uploadRes.status >= 300 || !uploadRes.body?.processedFiles?.[0]?.id) {
      throw new Error('Avatar upload failed');
    }
    return await getReadableUrl('nhost', uploadRes.body.processedFiles[0].id);
  }
  const { error } = await supabase.storage
    .from(BUCKETS.avatars)
    .upload(filePath, arrayBuffer, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(error.message || 'Avatar upload failed');
  return supabase.storage.from(BUCKETS.avatars).getPublicUrl(filePath).data.publicUrl;
};

/**
 * Generates a blurred low-res preview for locked content.
 */
export const uploadBlurredPreview = async (uri: string): Promise<Result<string>> => {
  try {
    const manipulated = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 100 } }],
      { compress: 0.2, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
    const ref = await uploadImage(manipulated.uri, BUCKETS.previews, { returnStorageRef: true });
    return success(ref);
  } catch (err: any) {
    return failure(err);
  }
};

/**
 * Uploads a premium media asset and registers it in the media_assets table.
 * bookingId is optional for creator-library posts and required for booking delivery assets.
 */
export const uploadMediaAsset = async (uri: string, ownerId: string, bookingId: string | null, priceZar?: number | null, title?: string | null): Promise<Result<any>> => {
  try {
    const manipulated = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1200 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );

    if (!manipulated.base64) {
      throw new Error('Could not generate media asset data');
    }

    const arrayBuffer = decode(manipulated.base64);
    const fileBlob = new Blob([arrayBuffer], { type: 'image/jpeg' });

    // Path keeps booking deliveries grouped while allowing creator-library uploads.
    const scope = bookingId ?? 'library';
    const fileName = `${ownerId}/${scope}/${Date.now()}.jpg`;
    
    // Upload to the 'media' bucket (not 'media_assets' — that doesn't exist)
    if (hasApiStorage) {
      const token = await getApiAccessToken();
      const uploadRes = await apiClient.post<{ path?: string; url?: string }>(
        '/storage/upload',
        {
          bucket: BUCKETS.media,
          path: fileName,
          contentType: 'image/jpeg',
          base64: manipulated.base64,
        },
        { token, timeoutMs: 30000 }
      );
      const objectPath = uploadRes.path ?? fileName;
      const previewRes = await uploadBlurredPreview(uri);
      const previewUrl = previewRes.success ? previewRes.data : '';
      const { data, error: dbError } = await backendDb
        .from('media_assets')
        .insert({
          owner_id: ownerId,
          booking_id: bookingId,
          bucket: BUCKETS.media,
          object_path: objectPath,
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
    }

    if (hasNhost) {
      const uploadRes = await nhost.storage.uploadFiles({
        'bucket-id': BUCKETS.media,
        'file[]': [fileBlob],
        'metadata[]': [{ name: fileName }],
      });
      if (uploadRes.status >= 300 || !uploadRes.body?.processedFiles?.[0]?.id) {
        throw new Error('Media upload failed');
      }
      const fileId = uploadRes.body.processedFiles[0].id;
      const previewRes = await uploadBlurredPreview(uri);
      const previewUrl = previewRes.success ? previewRes.data : '';
      const { data, error: dbError } = await backendDb
        .from('media_assets')
        .insert({
          owner_id: ownerId,
          booking_id: bookingId,
          bucket: BUCKETS.media,
          object_path: fileId,
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
    }

    const { error: uploadError } = await supabase.storage
      .from(BUCKETS.media)
      .upload(fileName, arrayBuffer, { contentType: 'image/jpeg' });

    if (uploadError) throw uploadError;

    // Generate a blurred low-res preview for locked content display
    const previewRes = await uploadBlurredPreview(uri);
    const previewUrl = previewRes.success ? previewRes.data : '';

    // Register asset in DB — bucket column must match actual bucket name
    const { data, error: dbError } = await backendDb
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

