import { supabase } from '../config/supabaseClient';
import { MediaAsset } from '../types';

export const fetchCreatorMedia = async (creatorId: string): Promise<MediaAsset[]> => {
  const { data, error } = await supabase
    .from('media_assets')
    .select('*')
    .eq('owner_id', creatorId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  return (data || []).map((asset) => ({
    ...asset,
    preview_url:
      asset.preview_url ||
      supabase.storage.from(asset.bucket).getPublicUrl(asset.object_path).data.publicUrl,
    full_url: asset.is_locked
      ? null
      : supabase.storage.from(asset.bucket).getPublicUrl(asset.object_path).data.publicUrl,
  }));
};

export const unlockMediaAsset = async (assetId: string): Promise<string> => {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  await supabase
    .from('media_access_logs')
    .insert({ media_asset_id: assetId, user_id: user.id, action: 'signed_url_requested' });

  const { data: asset, error } = await supabase
    .from('media_assets')
    .select('bucket, object_path')
    .eq('id', assetId)
    .single();

  if (error || !asset) throw new Error('Asset not found');

  const { data: signed, error: signErr } = await supabase.storage
    .from(asset.bucket)
    .createSignedUrl(asset.object_path, 3600);

  if (signErr || !signed?.signedUrl) throw new Error('Could not generate signed URL');

  return signed.signedUrl;
};
