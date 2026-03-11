import React, { createContext, useCallback, useContext, useState } from 'react';
import { supabase, hasSupabase } from '../config/supabaseClient';
import { Post, Comment, AppUser } from '../types';
import { logError } from '../utils/errors';
import { useAuth } from './AuthContext';

type SocialContextValue = {
  posts: Post[];
  loading: boolean;
  fetchPosts: () => Promise<void>;
  toggleLike: (postId: string) => Promise<void>;
  addComment: (postId: string, text: string) => Promise<void>;
};

const SocialContext = createContext<SocialContextValue | undefined>(undefined);

export const SocialProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPosts = useCallback(async () => {
    if (!hasSupabase) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('posts')
        .select(`*, profiles(full_name, avatar_url)`)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPosts(data.map((p: any) => ({
          ...p,
          author_id: p.author_id,
          user_name: p.profiles?.full_name,
          user_avatar: p.profiles?.avatar_url
      })));
    } catch (err) {
      logError('Social:fetchPosts', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleLike = async (postId: string) => {
    if (!currentUser) return;
    try {
      // Logic for toggle_post_like RPC or direct insert
      await supabase.rpc('toggle_post_like', { p_post_id: postId, p_user_id: currentUser.id });
      // Manual refresh or optimistic update
      fetchPosts(); 
    } catch (err) {
      logError('Social:toggleLike', err);
    }
  };

  return (
    <SocialContext.Provider value={{
      posts,
      loading,
      fetchPosts,
      toggleLike,
      addComment: async () => {} // Placeholder
    }}>
      {children}
    </SocialContext.Provider>
  );
};

export const useSocial = () => {
  const context = useContext(SocialContext);
  if (context === undefined) throw new Error('useSocial must be used within a SocialProvider');
  return context;
};
