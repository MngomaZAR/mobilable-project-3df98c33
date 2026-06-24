import { backendDb } from './backendGateway';
import { requireCurrentAuthenticatedUser } from '../config/currentUser';

export const toggleFollow = async (followingId: string): Promise<boolean> => {
    const user = await requireCurrentAuthenticatedUser();
    if (!user) throw new Error("Must be logged in to follow users");
    
    // Check if already following
    const { data: existing, error: checkErr } = await backendDb
        .from('follows')
        .select('*')
        .eq('follower_id', user.id)
        .eq('following_id', followingId)
        .single();
        
    if (checkErr && checkErr.code !== 'PGRST116') {
        throw checkErr;
    }
    
    if (existing) {
        // Unfollow
        const { error: delErr } = await backendDb
            .from('follows')
            .delete()
            .eq('follower_id', user.id)
            .eq('following_id', followingId);
            
        if (delErr) throw delErr;
        return false;
    } else {
        // Follow
        const { error: insErr } = await backendDb
            .from('follows')
            .insert({
                follower_id: user.id,
                following_id: followingId
            });
            
        if (insErr) throw insErr;
        return true;
    }
};

export const fetchUserFollowings = async (userId: string): Promise<string[]> => {
    const { data, error } = await backendDb
        .from('follows')
        .select('following_id')
        .eq('follower_id', userId);
        
    if (error) throw error;
    return (data || []).map((row: any) => row.following_id);
};
