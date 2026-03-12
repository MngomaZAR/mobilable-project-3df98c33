import { supabase } from '../config/supabaseClient';
import { MediaAsset } from '../types';
import { resolveStorageRef } from './uploadService';

export const fetchCreatorMedia = async (creatorId: string): Promise<MediaAsset[]> => {
  try {
    const { data, error } = await supabase
      .from('media_assets')
      .select('*')
      .eq('owner_id', creatorId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return await Promise.all(
      (data || []).map(async asset => ({
        ...asset,
        preview_url: asset.preview_url ? await resolveStorageRef(asset.preview_url) : await resolveStorageRef(asset.object_path, asset.bucket),
        full_url: asset.is_locked ? null : await resolveStorageRef(asset.object_path, asset.bucket),
      }))
    );
  } catch (err: any) {
    if (err.message?.includes('relation "media_assets" does not exist')) {
        // Mock data for UI prototyping
        return [
            { id: '1', owner_id: creatorId, bucket: 'post-images', object_path: 'mock1.jpg', is_locked: false, title: 'Behind the scenes', created_at: new Date().toISOString(), preview_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80', full_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=100' },
            { id: '2', owner_id: creatorId, bucket: 'post-images', object_path: 'mock2.jpg', is_locked: true, price_zar: 150, title: 'Exclusive Shoot', created_at: new Date(Date.now() - 86400000).toISOString(), preview_url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&q=80&blur=20', full_url: null },
            { id: '3', owner_id: creatorId, bucket: 'post-images', object_path: 'mock3.jpg', is_locked: true, price_zar: 300, title: 'Premium Set', created_at: new Date(Date.now() - 172800000).toISOString(), preview_url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=400&q=80&blur=20', full_url: null },
        ];
    }
    throw err;
  }
};

export const unlockMediaAsset = async (assetId: string): Promise<string> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    try {
        // Ideally, this calls an edge function that verifies payment and inserts into media_access_logs
        // For prototyping, we'll insert the log directly if table exists, or just return a mock URL
        await supabase.from('media_access_logs').insert({
            asset_id: assetId,
            user_id: user.id
        });

        // Get the asset details to generate signed URL
        const { data: asset } = await supabase.from('media_assets').select('*').eq('id', assetId).single();
        if (asset) {
             return await resolveStorageRef(asset.object_path, asset.bucket);
        }

        throw new Error("Asset not found");
    } catch(err: any) {
         // Mock return for prototyping
         return 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=800&q=100'; 
    }
};
