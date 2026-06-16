import { supabase } from '../config/supabaseClient';
import { hasNhost, nhost } from '../config/nhostClient';
import { requireCurrentAuthenticatedUser } from '../config/currentUser';
import { MediaAsset } from '../types';

export const fetchCreatorMedia = async (creatorId: string): Promise<MediaAsset[]> => {
  const { data, error } = await supabase
    .from('media_assets')
    .select('*')
    .eq('owner_id', creatorId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  const resolveUrl = async (bucket: string, objectPath: string) => {
    if (hasNhost) {
      const { body, status } = await nhost.storage.getFilePresignedURL(objectPath);
      if (status >= 300 || !body?.url) throw new Error('Unable to resolve media URL.');
      return body.url;
    }
    return supabase.storage.from(bucket).getPublicUrl(objectPath).data.publicUrl;
  };

  const assets = await Promise.all((data || []).map(async (asset) => ({
    ...asset,
    preview_url:
      asset.preview_url ||
      await resolveUrl(asset.bucket, asset.object_path),
    full_url: asset.is_locked
      ? null
      : await resolveUrl(asset.bucket, asset.object_path),
  })));

  return assets;
};

export const unlockMediaAsset = async (assetId: string): Promise<string> => {
  const user = await requireCurrentAuthenticatedUser();

  await supabase
    .from('media_access_logs')
    .insert({ asset_id: assetId, user_id: user.id, action: 'signed_url_requested' });

  const { data: asset, error } = await supabase
    .from('media_assets')
    .select('bucket, object_path')
    .eq('id', assetId)
    .single();

  if (error || !asset) throw new Error('Asset not found');

  if (hasNhost) {
    const { body, status } = await nhost.storage.getFilePresignedURL(asset.object_path);
    if (status >= 300 || !body?.url) throw new Error('Could not generate signed URL');
    return body.url;
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from(asset.bucket)
    .createSignedUrl(asset.object_path, 3600);

  if (signErr || !signed?.signedUrl) throw new Error('Could not generate signed URL');

  return signed.signedUrl;
};
