import React, { useState } from 'react';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppLogo } from '../components/AppLogo';
import { useAppData } from '../store/AppDataContext';
import { supabase, hasSupabase } from '../config/supabaseClient';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { makeRedirectUri } from 'expo-auth-session';
import { Ionicons } from '@expo/vector-icons';
import { UserRole } from '../types';

WebBrowser.maybeCompleteAuthSession();

type Mode = 'signin' | 'signup';

const SUPABASE_CALLBACK = 'https://mizdvqhvspkjayffaqqd.supabase.co/auth/v1/callback';

// Map raw Supabase auth errors to human-friendly messages
const friendlyAuthError = (raw: string): string => {
  const r = raw.toLowerCase();
  if (r.includes('invalid login credentials') || r.includes('invalid_credentials'))
    return 'Incorrect email or password. Please try again.';
  if (r.includes('email not confirmed'))
    return 'Please check your email and click the confirmation link we sent you.';
  if (r.includes('user already registered'))
    return 'An account with this email already exists. Try signing in instead.';
  if (r.includes('password should be at least'))
    return 'Your password must be at least 6 characters long.';
  if (r.includes('unsupported provider') || r.includes('provider is not enabled'))
    return 'This sign-in method isn\'t enabled yet. Please use email & password for now.';
  if (r.includes('network') || r.includes('failed to fetch'))
    return 'Unable to connect. Check your internet connection and try again.';
  return raw;
};

type RoleOption = { role: UserRole; label: string; description: string; icon: string; color: string };

const ROLE_OPTIONS: RoleOption[] = [
  {
    role: 'client',
    label: 'Client',
    description: 'Book photographers & models for your events, shoots and projects.',
    icon: 'person',
    color: '#3b82f6',
  },
  {
    role: 'photographer',
    label: 'Photographer',
    description: 'Showcase your portfolio, accept bookings, and grow your business.',
    icon: 'camera',
    color: '#8b5cf6',
  },
  {
    role: 'model',
    label: 'Model',
    description: 'List your services, get booked for shoots, and collaborate creatively.',
    icon: 'body',
    color: '#ec4899',
  },
];

const AuthScreen: React.FC = () => {
  const { signIn, signUp, authenticating, error } = useAppData();
  const [mode, setMode] = useState<Mode>('signin');
  const [selectedRole, setSelectedRole] = useState<UserRole>('client');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [localSuccess, setLocalSuccess] = useState<string | null>(null);

  const displayError = error ? friendlyAuthError(error) : localMessage;

  const submit = async () => {
    setLocalMessage(null);
    setLocalSuccess(null);
    if (!email.trim() || !password) {
      setLocalMessage('Please enter your email and password.');
      return;
    }
    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRx.test(email.trim())) {
      setLocalMessage('Please enter a valid email address.');
      return;
    }
    if (mode === 'signin') {
      await signIn(email.trim(), password);
    } else {
      const user = await signUp(email.trim(), password, selectedRole);
      if (user) {
        setLocalSuccess('🎉 Account created! Check your email to verify, then sign in.');
        setEmail('');
        setPassword('');
        setMode('signin');
      }
    }
  };

  const handleOAuth = async (provider: 'google' | 'apple') => {
    setLocalMessage(null);
    setLocalSuccess(null);
    if (!hasSupabase) {
      setLocalMessage('Single sign-on requires backend configuration.');
      return;
    }
    try {
      const redirectTo = Platform.OS === 'web'
        ? window.location.origin
        : makeRedirectUri({ preferLocalhost: false });

      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: SUPABASE_CALLBACK,
          skipBrowserRedirect: Platform.OS !== 'web',
          queryParams: provider === 'apple' ? { response_type: 'code' } : undefined,
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
      setLocalMessage(friendlyAuthError(err?.message ?? `Unable to continue with ${provider}.`));
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <AppLogo size={72} />
            <Text style={styles.title}>Welcome to Papzi</Text>
            <Text style={styles.subtitle}>
              {mode === 'signin'
                ? 'Sign in to book photographers and models or manage your services.'
                : 'Create your account to get started.'}
            </Text>
          </View>

          {/* Mode Switcher */}
          <View style={styles.switcher}>
            <TouchableOpacity
              style={[styles.switchBtn, mode === 'signin' && styles.switchBtnActive]}
              onPress={() => { setMode('signin'); setLocalMessage(null); setLocalSuccess(null); }}
            >
              <Text style={[styles.switchTxt, mode === 'signin' && styles.switchTxtActive]}>Sign In</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.switchBtn, mode === 'signup' && styles.switchBtnActive]}
              onPress={() => { setMode('signup'); setLocalMessage(null); setLocalSuccess(null); }}
            >
              <Text style={[styles.switchTxt, mode === 'signup' && styles.switchTxtActive]}>Create Account</Text>
            </TouchableOpacity>
          </View>

          {/* Role Picker — only on signup */}
          {mode === 'signup' && (
            <View style={styles.roleSection}>
              <Text style={styles.roleLabel}>I am a...</Text>
              <View style={styles.roleRow}>
                {ROLE_OPTIONS.map((opt) => {
                  const active = selectedRole === opt.role;
                  return (
                    <TouchableOpacity
                      key={opt.role}
                      style={[styles.roleCard, active && { borderColor: opt.color, borderWidth: 2, backgroundColor: opt.color + '12' }]}
                      onPress={() => setSelectedRole(opt.role)}
                    >
                      <View style={[styles.roleIconBox, { backgroundColor: active ? opt.color : '#f1f5f9' }]}>
                        <Ionicons name={opt.icon as any} size={20} color={active ? '#fff' : '#64748b'} />
                      </View>
                      <Text style={[styles.roleTitle, active && { color: opt.color, fontWeight: '800' }]}>{opt.label}</Text>
                      <Text style={styles.roleDesc}>{opt.description}</Text>
                      {active && (
                        <View style={[styles.roleCheck, { backgroundColor: opt.color }]}>
                          <Ionicons name="checkmark" size={12} color="#fff" />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Form */}
          <View style={styles.form}>
            <View style={styles.inputRow}>
              <Ionicons name="mail-outline" size={20} color="#64748b" style={styles.inputIcon} />
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="Email address"
                placeholderTextColor="#94a3b8"
                style={styles.input}
                autoComplete="email"
              />
            </View>

            <View style={[styles.inputRow, { marginTop: 14 }]}>
              <Ionicons name="lock-closed-outline" size={20} color="#64748b" style={styles.inputIcon} />
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                placeholder="Password"
                placeholderTextColor="#94a3b8"
                style={styles.input}
                autoComplete={mode === 'signin' ? 'password' : 'new-password'}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            {/* Error / Success feedback */}
            {displayError ? (
              <View style={styles.alertBox}>
                <Ionicons name="alert-circle" size={16} color="#dc2626" style={{ marginRight: 8 }} />
                <Text style={styles.alertText}>{displayError}</Text>
              </View>
            ) : localSuccess ? (
              <View style={[styles.alertBox, styles.successBox]}>
                <Ionicons name="checkmark-circle" size={16} color="#16a34a" style={{ marginRight: 8 }} />
                <Text style={[styles.alertText, { color: '#16a34a' }]}>{localSuccess}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.submitBtn, authenticating && styles.submitBtnDisabled]}
              onPress={submit}
              disabled={authenticating}
            >
              <Text style={styles.submitTxt}>
                {authenticating ? 'Please wait...' : mode === 'signin' ? 'Sign In' : `Create ${selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1)} Account`}
              </Text>
            </TouchableOpacity>

            {/* Divider */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerTxt}>or continue with</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* OAuth Buttons */}
            <View style={styles.oauthRow}>
              <TouchableOpacity style={styles.oauthBtn} onPress={() => handleOAuth('google')} disabled={authenticating}>
                <Ionicons name="logo-google" size={18} color="#0f172a" style={{ marginRight: 8 }} />
                <Text style={styles.oauthTxt}>Google</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.oauthBtn} onPress={() => handleOAuth('apple')} disabled={authenticating}>
                <Ionicons name="logo-apple" size={18} color="#0f172a" style={{ marginRight: 8 }} />
                <Text style={styles.oauthTxt}>Apple</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.legalTxt}>
              By continuing, you agree to our Terms of Service and Privacy Policy.
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, backgroundColor: '#0a0a0f', justifyContent: 'center', padding: 20, paddingVertical: 40 },
  kav: { flex: 1, justifyContent: 'center' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 28,
    padding: 28,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 15 },
    maxWidth: 460,
    width: '100%',
    alignSelf: 'center',
  },
  header: { alignItems: 'center', marginBottom: 28 },
  title: { fontSize: 26, fontWeight: '800', color: '#0f172a', marginTop: 14, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#64748b', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  switcher: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 14,
    padding: 4,
    marginBottom: 24,
  },
  switchBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  switchBtnActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  switchTxt: { color: '#64748b', fontWeight: '600', fontSize: 14 },
  switchTxtActive: { color: '#0f172a', fontWeight: '800' },
  // Role picker
  roleSection: { marginBottom: 24 },
  roleLabel: { fontSize: 13, fontWeight: '700', color: '#64748b', marginBottom: 12, letterSpacing: 0.5, textTransform: 'uppercase' },
  roleRow: { flexDirection: 'row', gap: 10 },
  roleCard: {
    flex: 1,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    position: 'relative',
  },
  roleIconBox: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  roleTitle: { fontSize: 13, fontWeight: '700', color: '#0f172a', textAlign: 'center', marginBottom: 4 },
  roleDesc: { fontSize: 10, color: '#94a3b8', textAlign: 'center', lineHeight: 14 },
  roleCheck: { position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  // Form
  form: { width: '100%' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 56,
  },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, fontSize: 15, color: '#0f172a', height: '100%' },
  eyeBtn: { padding: 6 },
  alertBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fef2f2',
    padding: 12,
    borderRadius: 10,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  successBox: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  alertText: { color: '#dc2626', flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  submitBtn: {
    marginTop: 20,
    backgroundColor: '#0f172a',
    height: 56,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 22 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#e2e8f0' },
  dividerTxt: { marginHorizontal: 14, color: '#94a3b8', fontWeight: '500', fontSize: 13 },
  oauthRow: { flexDirection: 'row', gap: 12 },
  oauthBtn: {
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
  oauthTxt: { color: '#0f172a', fontWeight: '700', fontSize: 14 },
  legalTxt: { textAlign: 'center', color: '#94a3b8', fontSize: 11, marginTop: 18, lineHeight: 16 },
});

export default AuthScreen;
