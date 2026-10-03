import { backendDb } from './backendGateway';
import { Photographer } from '../types';
import { mapPhotographerRow } from '../utils/mappings';

// Deterministic ranking of the visible, verified provider catalog, not an AI model.
export const fetchRecommendedMatches = async (
    location: string, 
    preferredStyle: string, 
    maxBudget: number,
    limit: number = 5
): Promise<Photographer[]> => {
    try {
        const { data, error } = await backendDb
            .from('photographers')
            .select('*')
            .order('rating', { ascending: false })
            .limit(120);
            
        if (error) throw error;
        
        const ids = [...new Set((data || []).map((row: any) => row.id).filter(Boolean))];
        if (!ids.length) return [];
        const { data: profiles, error: profileError } = await backendDb.from('profiles')
            .select('id, full_name, avatar_url, city, bio, role, is_photographer, is_test_account, verified, kyc_status, age_verified')
            .in('id', ids);
        if (profileError) throw profileError;
        const byId = new Map((profiles || []).map((profile: any) => [profile.id, profile]));
        let matchables: Photographer[] = (data || []).filter((row: any) => {
            const profile: any = byId.get(row.id);
            return profile && !profile.is_test_account && profile.age_verified
                && (profile.verified || profile.kyc_status === 'approved')
                && (profile.is_photographer === true || profile.role === 'photographer');
        }).map((row: any) => mapPhotographerRow({ ...row, profiles: [byId.get(row.id)] }));
        
        // Very basic matching heuristic
        matchables = matchables.map(photographer => {
           let score = 0;
           
           // Location match (highest weight)
           if (location && photographer.location?.toLowerCase().includes(location.toLowerCase())) {
               score += 50;
           }
           
           // Style/Tag match (medium weight)
           if (preferredStyle) {
               const lowerStyle = preferredStyle.toLowerCase();
               if (photographer.style?.toLowerCase() === lowerStyle) score += 20;
               if (photographer.tags?.some(tag => tag.toLowerCase().includes(lowerStyle))) score += 15;
           }
           
           if (maxBudget > 0) {
               const rate = photographer.hourly_rate;
               score += typeof rate === 'number' && rate > 0 && rate <= maxBudget ? 20 : -10;
           }
           
           // Rating base score
           score += (photographer.rating || 0) * 2;
           
           return { ...photographer, _match_score: score };
        });
        
        // Sort by score
        matchables.sort((a, b) => ((b as any)._match_score || 0) - ((a as any)._match_score || 0));
        
        return matchables.slice(0, Math.min(120, Math.max(0, Math.floor(limit))));
        
    } catch (err) {
        console.warn('Matching algorithm failed:', err);
        throw err;
    }
};
