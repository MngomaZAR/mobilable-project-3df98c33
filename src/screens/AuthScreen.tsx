import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { AppLogo } from '../components/AppLogo';
import { useAppData } from '../store/AppDataContext';
import { AppUser } from '../types';
import { supabase } from '../config/supabaseClient';

type Mode = 'signin' | 'signup';

const AuthScreen: React.FC = () => {
  const { signIn, signUp, signOut, currentUser, authenticating, error } = useAppData();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AppUser['role']>('client');

  const submit = async () => {
    if (!email || !password) {
      Alert.alert('Missing fields', 'Enter both email and password to continue.');
      return;
    }
    if (mode === 'signin') {
      const user = await signIn(email, password);
      if (user) Alert.alert('Signed in', `Welcome back, ${user.email}.`);
    } else {
      const user = await signUp(email, password, role);
      if (user) Alert.alert('Account created', 'We emailed a confirmation link to verify your address.');
    }
  };

  const handleSignOut = async () => {
    await signOut();
    Alert.alert('Signed out', 'You have been signed out securely.');
  };

  const handleOAuthSignIn = async (provider: 'google' | 'apple') => {
    try {
      const redirectTo = 'papzi://auth/callback';
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });
      if (oauthError) {
        throw oauthError;
      }
      if (data?.url) {
        await Linking.openURL(data.url);
      } else {
        Alert.alert('Sign in unavailable', 'Unable to start sign in. Please try again.');
      }
    } catch (err: any) {
      Alert.alert('Sign in failed', err?.message ?? 'Unable to sign in right now.');
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <View style={styles.header}>
        <AppLogo size={88} />
        <Text style={styles.title}>Papzi</Text>
        <Text style={styles.subtitle}>Sign in to book your photographer.</Text>
      </View>

      <View style={styles.switcher}>
        <TouchableOpacity
          style={[styles.switchButton, mode === 'signin' && styles.switchButtonActive]}
          onPress={() => setMode('signin')}
        >
          <Text style={[styles.switchText, mode === 'signin' && styles.switchTextActive]}>Sign in</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.switchButton, mode === 'signup' && styles.switchButtonActive]}
          onPress={() => setMode('signup')}
        >
          <Text style={[styles.switchText, mode === 'signup' && styles.switchTextActive]}>Create account</Text>
        </TouchableOpacity>
      </View>

      {mode === 'signup' ? (
        <View style={styles.roleRow}>
          {(['client', 'photographer', 'admin'] as AppUser['role'][]).map((value) => (
            <TouchableOpacity
              key={value}
              style={[styles.roleChip, role === value && styles.roleChipActive]}
              onPress={() => setRole(value)}
            >
              <Text style={[styles.roleText, role === value && styles.roleTextActive]}>{value}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <View style={styles.form}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="you@example.com"
          style={styles.input}
        />
        <Text style={[styles.label, styles.labelSpacing]}>Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
          style={styles.input}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={styles.submit} onPress={submit} disabled={authenticating}>
          <Text style={styles.submitText}>{authenticating ? 'Submitting...' : mode === 'signin' ? 'Sign in' : 'Sign up'}</Text>
        </TouchableOpacity>
        <View style={styles.oauthRow}>
          <TouchableOpacity style={styles.oauthButton} onPress={() => handleOAuthSignIn('google')} disabled={authenticating}>
            <Text style={styles.oauthText}>Continue with Google</Text>
          </TouchableOpacity>
          {Platform.OS === 'ios' ? (
            <TouchableOpacity style={styles.oauthButton} onPress={() => handleOAuthSignIn('apple')} disabled={authenticating}>
              <Text style={styles.oauthText}>Continue with Apple</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {currentUser ? (
          <TouchableOpacity style={styles.secondary} onPress={handleSignOut} disabled={authenticating}>
            <Text style={styles.secondaryText}>Sign out ({currentUser.email})</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f7fb',
    padding: 16,
  },
  header: {
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 10,
  },
  subtitle: {
    color: '#475569',
    textAlign: 'center',
    marginTop: 4,
  },
  switcher: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  switchButton: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
  },
  switchButtonActive: {
    backgroundColor: '#0f172a',
  },
  switchText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  switchTextActive: {
    color: '#fff',
  },
  roleRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  roleChip: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#e2e8f0',
    borderRadius: 12,
    marginRight: 8,
  },
  roleChipActive: {
    backgroundColor: '#0f172a',
  },
  roleText: {
    color: '#0f172a',
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  roleTextActive: {
    color: '#fff',
  },
  form: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
  },
  label: {
    fontWeight: '700',
    color: '#0f172a',
  },
  labelSpacing: {
    marginTop: 10,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 12,
    marginTop: 6,
    backgroundColor: '#f8fafc',
  },
  error: {
    color: '#dc2626',
    marginTop: 8,
  },
  submit: {
    marginTop: 14,
    backgroundColor: '#0f172a',
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  submitText: {
    color: '#fff',
    fontWeight: '700',
  },
  oauthRow: {
    marginTop: 10,
    gap: 8,
  },
  oauthButton: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    paddingVertical: 12,
    alignItems: 'center',
  },
  oauthText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  secondary: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
  },
  secondaryText: {
    color: '#0f172a',
    fontWeight: '700',
  },
});

export default AuthScreen;
