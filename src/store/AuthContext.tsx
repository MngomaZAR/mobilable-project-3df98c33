import React, { createContext, useCallback, useContext, useEffect, useState, useRef } from 'react';
import { supabase, hasSupabase } from '../config/supabaseClient';
import { AppUser, UserRole, PrivacySettings } from '../types';
import { logError, formatAuthError } from '../utils/errors';
import { mapSupabaseUser } from '../utils/mappings';
import AsyncStorage from '@react-native-async-storage/async-storage';

type AuthContextValue = {
  currentUser: AppUser | null;
  loading: boolean;
  authenticating: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<AppUser | null>;
  signUp: (email: string, password: string, role?: UserRole, fullName?: string) => Promise<AppUser | null>;
  signOut: () => Promise<void>;
  updateProfile: (changes: Partial<AppUser>) => Promise<void>;
  updateProfilePicture: (uri: string) => Promise<void>;
  revalidateSession: () => Promise<AppUser | null>;
  setError: (msg: string | null) => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const PROFILE_SELECT = `id, full_name, avatar_url, city, role, verified, bio, phone, push_token, contact_details`;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async (userId: string): Promise<AppUser | null> => {
    if (!hasSupabase) return null;
    try {
      const { data, error } = await supabase.from('profiles').select(PROFILE_SELECT).eq('id', userId).maybeSingle();
      if (error) throw error;
      return (data as any) ?? null;
    } catch (err) {
      logError('Auth:fetchProfile', err);
      return null;
    }
  }, []);

  const revalidateSession = useCallback(async (): Promise<AppUser | null> => {
    if (!hasSupabase) {
      setLoading(false);
      return null;
    }
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const profile = await fetchProfile(session.user.id);
        const user = mapSupabaseUser(session.user, profile);
        setCurrentUser(user);
        return user;
      }
      setCurrentUser(null);
      return null;
    } catch (err) {
      logError('Auth:revalidate', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [fetchProfile]);

  useEffect(() => {
    revalidateSession();
    
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth State Change Event:', event);
      if (session?.user) {
        const profile = await fetchProfile(session.user.id);
        setCurrentUser(mapSupabaseUser(session.user, profile));
      } else {
        setCurrentUser(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [revalidateSession, fetchProfile]);

  const signIn = async (email: string, password: string) => {
    setAuthenticating(true);
    setError(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const profile = await fetchProfile(data.user.id);
      const user = mapSupabaseUser(data.user, profile);
      setCurrentUser(user);
      return user;
    } catch (err: any) {
      const msg = formatAuthError(err);
      setError(msg);
      return null;
    } finally {
      setAuthenticating(false);
    }
  };

  const signUp = async (email: string, password: string, role: UserRole = 'client', fullName?: string) => {
    setAuthenticating(true);
    setError(null);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName, role } }
      });
      if (error) throw error;
      if (data.user) {
         // The profile is created via a DB trigger, but we can't fetch it until email is verified 
         // unless auto-confirm is on. We return a partial user for now.
         return mapSupabaseUser(data.user, { full_name: fullName, role });
      }
      return null;
    } catch (err: any) {
      const msg = formatAuthError(err);
      setError(msg);
      return null;
    } finally {
      setAuthenticating(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    await AsyncStorage.removeItem('movable-app-state-v2');
  };

  const updateProfile = async (changes: Partial<AppUser>) => {
    if (!currentUser || !hasSupabase) return;
    try {
      const { error } = await supabase.from('profiles').update(changes).eq('id', currentUser.id);
      if (error) throw error;
      setCurrentUser({ ...currentUser, ...changes });
    } catch (err) {
      logError('Auth:updateProfile', err);
      throw err;
    }
  };

  return (
    <AuthContext.Provider value={{
      currentUser,
      loading,
      authenticating,
      error,
      signIn,
      signUp,
      signOut,
      updateProfile,
      updateProfilePicture: async () => {}, // Placeholder for now
      revalidateSession,
      setError
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
