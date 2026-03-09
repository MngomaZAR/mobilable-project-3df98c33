import { supabase } from '../config/supabaseClient';
import { BUCKETS } from '../config/environment';
import * as ImageManipulator from 'expo-image-manipulator';
import { Result, success, failure } from '../utils/result';

/**
 * Uploads an image to Supabase Storage and returns the public URL.
 * Includes automatic compression and resizing.
 */
export const uploadImage = async (uri: string, bucket: string = BUCKETS.posts): Promise<string> => {
  try {
    const manipulated = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1200 } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
    );

    const response = await fetch(manipulated.uri);
    const blob = await response.blob();

    const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.jpg`;
    const filePath = `uploads/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(filePath, blob, { contentType: 'image/jpeg', upsert: false });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(filePath);
    return publicUrl;
  } catch (error: any) {
    console.error(`Upload error for bucket "${bucket}":`, error);
    if (error.message?.toLowerCase().includes('bucket not found')) {
      throw new Error(`Storage bucket "${bucket}" not found. Please create it in your Supabase dashboard.`);
    }
    throw new Error(error.message || 'Image upload failed');
  }
};

/**
 * Uploads an avatar image; uses the dedicated avatars bucket.
 */
export const uploadAvatar = async (uri: string): Promise<string> => {
  return uploadImage(uri, BUCKETS.avatars);
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
    const url = await uploadImage(manipulated.uri, BUCKETS.previews);
    return success(url);
  } catch (err: any) {
    return failure(err);
  }
};

/**
 * Uploads a premium media asset and registers it in the media_assets table
 */
export const uploadMediaAsset = async (uri: string, ownerId: string, bookingId?: string | null, priceZar?: number | null, title?: string | null): Promise<Result<any>> => {
  try {
    const manipulated = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1200 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
    );

    const blob = await (await fetch(manipulated.uri)).blob();
    const fileName = `${ownerId}-${Date.now()}.jpg`;
    
    // Upload original
    const { error: uploadError } = await supabase.storage
      .from('media_assets')
      .upload(fileName, blob, { contentType: 'image/jpeg' });

    if (uploadError) throw uploadError;

    // Generate preview
    const previewRes = await uploadBlurredPreview(uri);
    const previewUrl = previewRes.success ? previewRes.data : '';

    // Register asset in DB
    const { data, error: dbError } = await supabase
      .from('media_assets')
      .insert({
        owner_id: ownerId,
        booking_id: bookingId,
        bucket: 'media_assets',
        object_path: fileName,
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
