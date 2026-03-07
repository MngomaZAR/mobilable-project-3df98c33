import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { AppLogo } from '../components/AppLogo';
import { useAppData } from '../store/AppDataContext';
import { supabase, hasSupabase } from '../config/supabaseClient';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { makeRedirectUri } from 'expo-auth-session';
import { Ionicons } from '@expo/vector-icons';

WebBrowser.maybeCompleteAuthSession();

type Mode = 'signin' | 'signup';

const AuthScreen: React.FC = () => {
  const { signIn, signUp, signOut, currentUser, authenticating, error } = useAppData();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localMessage, setLocalMessage] = useState<string | null>(null);

  const submit = async () => {
    setLocalMessage(null);
    if (!email || !password) {
      setLocalMessage('Enter both email and password to continue.');
      return;
    }
    if (mode === 'signin') {
      const user = await signIn(email, password);
    } else {
      const user = await signUp(email, password);
      if (user) setLocalMessage('Account created! We emailed a confirmation link to verify your address.');
    }
  };

  const handleSignOut = async () => {
    await signOut();
  };

  const handleOAuth = async (provider: 'google' | 'apple') => {
    setLocalMessage(null);
    if (!hasSupabase) {
      setLocalMessage('Single sign-on needs backend configuration.');
      return;
    }
    try {
      const redirectTo = makeRedirectUri({
        preferLocalhost: true
      });

      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: Platform.OS !== 'web',
        },
      });

      if (oauthError) throw oauthError;

      if (Platform.OS !== 'web' && data?.url) {
        const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (res.type === 'success' && res.url) {
          const params = Linking.parse(res.url);
          if (params.queryParams?.error_description) {
            throw new Error(params.queryParams.error_description as string);
          }
        }
      }
    } catch (err: any) {
      setLocalMessage(err?.message || `Unable to continue with ${provider}. Verify configuration.`);
    }
  };

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <View style={styles.header}>
            <AppLogo size={64} />
            <Text style={styles.title}>Welcome to Papzi</Text>
            <Text style={styles.subtitle}>Log in or sign up to book top photographers and manage your gallery.</Text>
          </View>

          <View style={styles.switcher}>
            <TouchableOpacity style={[styles.switchButton, mode === 'signin' && styles.switchButtonActive]} onPress={() => setMode('signin')}>
              <Text style={[styles.switchText, mode === 'signin' && styles.switchTextActive]}>Sign in</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.switchButton, mode === 'signup' && styles.switchButtonActive]} onPress={() => setMode('signup')}>
              <Text style={[styles.switchText, mode === 'signup' && styles.switchTextActive]}>Sign up</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.form}>
            <View style={styles.inputWrapper}>
              <View style={styles.inputIcon}>
                <Ionicons name="mail-outline" size={20} color="#64748b" />
              </View>
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="Email address"
                placeholderTextColor="#94a3b8"
                style={styles.input}
              />
            </View>

            <View style={[styles.inputWrapper, { marginTop: 14 }]}>
              <View style={styles.inputIcon}>
                <Ionicons name="lock-closed-outline" size={20} color="#64748b" />
              </View>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder="Password"
                placeholderTextColor="#94a3b8"
                style={styles.input}
              />
            </View>

            {(error || localMessage) && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color="#dc2626" style={{ marginRight: 6 }} />
                <Text style={styles.errorText}>{error || localMessage}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.submit, authenticating && styles.submitDisabled]}
              onPress={submit}
              disabled={authenticating}
            >
              <Text style={styles.submitText}>{authenticating ? 'Processing...' : mode === 'signin' ? 'Sign in' : 'Create account'}</Text>
            </TouchableOpacity>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.oauthRow}>
              <TouchableOpacity style={styles.oauthButton} onPress={() => handleOAuth('google')} disabled={authenticating}>
                <Ionicons name="logo-google" size={18} color="#0f172a" style={{ marginRight: 8 }} />
                <Text style={styles.oauthText}>Google</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.oauthButton} onPress={() => handleOAuth('apple')} disabled={authenticating}>
                <Ionicons name="logo-apple" size={18} color="#0f172a" style={{ marginRight: 8 }} />
                <Text style={styles.oauthText}>Apple</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  keyboardView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  content: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 32,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 16,
  },
  subtitle: {
    color: '#64748b',
    textAlign: 'center',
    marginTop: 8,
    fontSize: 15,
    lineHeight: 22,
  },
  switcher: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    padding: 4,
    marginBottom: 24,
  },
  switchButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  switchButtonActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  switchText: {
    color: '#64748b',
    fontWeight: '600',
    fontSize: 15,
  },
  switchTextActive: {
    color: '#0f172a',
    fontWeight: '700',
  },
  form: {
    width: '100%',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 56,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#0f172a',
    height: '100%',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    padding: 12,
    borderRadius: 10,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorText: {
    color: '#dc2626',
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  submit: {
    marginTop: 24,
    backgroundColor: '#0f172a',
    height: 56,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitDisabled: {
    opacity: 0.7,
  },
  submitText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e2e8f0',
  },
  dividerText: {
    marginHorizontal: 16,
    color: '#94a3b8',
    fontWeight: '500',
  },
  oauthRow: {
    flexDirection: 'row',
    gap: 16,
  },
  oauthButton: {
    flex: 1,
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 14,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  oauthText: {
    color: '#0f172a',
    fontWeight: '700',
    fontSize: 15,
  },
});

export default AuthScreen;
