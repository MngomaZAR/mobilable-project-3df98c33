import React, { createContext, useContext, useMemo } from 'react';
import { AppUser, UserRole } from '../types';
import { useAppData } from './AppDataContext';

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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    currentUser,
    loading,
    authenticating,
    error,
    signIn,
    signUp,
    signOut,
    updateProfile,
    updateProfilePicture,
    revalidateSession,
    setState,
  } = useAppData();

  const value = useMemo<AuthContextValue>(
    () => ({
      currentUser,
      loading,
      authenticating,
      error,
      signIn,
      signUp,
      signOut,
      updateProfile,
      updateProfilePicture,
      revalidateSession,
      setError: (msg: string | null) => setState({ error: msg }),
    }),
    [
      currentUser,
      loading,
      authenticating,
      error,
      signIn,
      signUp,
      signOut,
      updateProfile,
      updateProfilePicture,
      revalidateSession,
      setState,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
