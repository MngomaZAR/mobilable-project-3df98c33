import { supabase } from '../config/supabaseClient';
import { Photographer } from '../types';

/**
 * Mocks an AI matching algorithm that scores photographers based on cosine similarity of 
 * styles, location, and budget constraints.
 * In a real-world scenario, this would be an edge function that leverages pgvector in Supabase
 * to do high-performance embeddings matching. For Phase 4 MVP, we will run the logic here
 * but structure it so it can be swapped out easily.
 */
export const fetchRecommendedMatches = async (
    location: string, 
    preferredStyle: string, 
    maxBudget: number,
    limit: number = 5
): Promise<Photographer[]> => {
    try {
        // Fetch all photographers
        const { data, error } = await supabase
            .from('photographers')
            .select(`
                *,
                profiles (
                   full_name, avatar_url, city, role, is_photographer, is_test_account
                )
            `);
            
        if (error) throw error;
        
        let matchables = (data || []).map((row: any) => ({
            ...row,
            name: row.profiles?.full_name || 'Photographer',
            avatar_url: row.profiles?.avatar_url || '',
            tags: row.tags || [],
        })) as Photographer[];

        matchables = matchables.filter((photographer: any) => {
           const profile = photographer.profiles;
           if (!profile) return true;
           return !profile.is_test_account &&
             (profile.is_photographer === true || profile.role === 'photographer');
        });
        
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
           
           // Budget match (negative deduction if over budget)
           if (maxBudget > 0) {
               // Assuming price_range is e.g '$$'
               const estPrice = photographer.price_range.length * 500; // rough mapping: 1$ = 500
               if (estPrice <= maxBudget) score += 10;
               else score -= 10;
               
               if (photographer.hourly_rate && photographer.hourly_rate <= maxBudget) {
                   score += 20;
               }
           }
           
           // Rating base score
           score += (photographer.rating || 0) * 2;
           
           return { ...photographer, _match_score: score };
        });
        
        // Sort by score
        matchables.sort((a, b) => ((b as any)._match_score || 0) - ((a as any)._match_score || 0));
        
        return matchables.slice(0, limit);
        
    } catch (err) {
        console.warn('Matching algorithm failed:', err);
        return [];
    }
};
