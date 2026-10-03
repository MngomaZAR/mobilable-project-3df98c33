import React, { useState, useEffect, useRef } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
  Image,
  ActivityIndicator,
  Modal,
  Platform,
  Share,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { StackNavigationProp } from '@react-navigation/stack';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppData } from '../store/AppDataContext';
import { useTheme, ThemeMode } from '../store/ThemeContext';
import { environment } from '../config/environment';
import { RootStackParamList } from '../navigation/types';
import { ActionModal } from '../components/ActionModal';
import { LEGAL_CONTENT } from '../constants/LegalContent';
import { getAccountDeletionStatus, requestAccountDeletion } from '../services/accountService';
import { BRAND, PLACEHOLDER_AVATAR } from '../utils/constants';
import { backendDb } from '../services/backendGateway';
import { registerForPushNotificationsAsync, savePushTokenAsync } from '../services/notificationService';
import { isModelUser, isPhotographerUser, isProviderUser } from '../utils/userRole';
import { apiClient } from '../config/apiClient';
import { getApiAccessToken } from '../config/apiSession';

type Navigation = StackNavigationProp<RootStackParamList, 'Root'>;
type LoginSession = { id: string; created_at: string; expires_at: string; current: boolean };

const formatSessionDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
};

const THEME_OPTIONS: { label: string; value: ThemeMode; icon: string }[] = [
  { label: 'Light', value: 'light', icon: 'sunny' },
  { label: 'Dark', value: 'dark', icon: 'moon' },
  { label: 'Auto', value: 'system', icon: 'phone-portrait' },
];

const SettingsScreen: React.FC = () => {
  const { resetState, saving, currentUser, signOut, updateProfilePicture } = useAppData();
  const { colors, isDark, themeMode, setThemeMode } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Navigation>();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [sessionsVisible, setSessionsVisible] = useState(false);
  const [sessions, setSessions] = useState<LoginSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsRefresh, setSessionsRefresh] = useState(0);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const sessionsRequest = useRef(0);
  const [avatarPreviewUri, setAvatarPreviewUri] = useState<string | null>(null);
  const userMetadata =
    currentUser && typeof currentUser === 'object' && 'user_metadata' in currentUser
      ? ((currentUser as Record<string, unknown>).user_metadata as Record<string, unknown> | undefined)
      : undefined;
  const isModelAccount = isModelUser(currentUser);
  const isPhotographerAccount = isPhotographerUser(currentUser);
  const isProviderAccount = isProviderUser(currentUser);
  const profileLink = currentUser?.id ? `papzi://profile/${encodeURIComponent(currentUser.id)}` : null;
  const canShareProfile = Platform.OS !== 'web' ||
    (typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  const canCopyProfile = Platform.OS === 'web' && typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.writeText === 'function';

  useEffect(() => {
    const request = ++sessionsRequest.current;
    setSessions([]);
    setSessionsError(null);
    setRevokingSessionId(null);
    setSessionsLoading(false);
    if (sessionsVisible && currentUser?.id) {
      setSessionsLoading(true);
      const loadSessions = async () => {
        try {
          const token = await getApiAccessToken();
          if (request !== sessionsRequest.current) return;
          if (!token) throw new Error('Please sign in again.');
          const response = await apiClient.get<{ sessions: LoginSession[] }>('/auth/sessions', { token });
          if (!Array.isArray(response.sessions) || response.sessions.some(session =>
            !session || typeof session.id !== 'string' || !session.id ||
            typeof session.current !== 'boolean' || typeof session.created_at !== 'string' ||
            typeof session.expires_at !== 'string'
          )) throw new Error('Invalid sessions response.');
          if (request === sessionsRequest.current) setSessions(response.sessions);
        } catch {
          if (request === sessionsRequest.current) setSessionsError('Could not load sessions. Please try again.');
        } finally {
          if (request === sessionsRequest.current) setSessionsLoading(false);
        }
      };
      void loadSessions();
    } else if (!currentUser?.id) {
      setSessionsVisible(false);
    }
    return () => { sessionsRequest.current += 1; };
  }, [sessionsVisible, currentUser?.id, sessionsRefresh]);

  const handleRevokeSession = async (session: LoginSession) => {
    if (session.current || revokingSessionId) return;
    const request = sessionsRequest.current;
    setRevokingSessionId(session.id);
    setSessionsError(null);
    try {
      const token = await getApiAccessToken();
      if (request !== sessionsRequest.current) return;
      if (!token) throw new Error('Please sign in again.');
      await apiClient.post('/auth/sessions/revoke', { session_id: session.id }, { token });
      if (request === sessionsRequest.current) setSessionsRefresh(value => value + 1);
    } catch {
      if (request === sessionsRequest.current) setSessionsError('Could not revoke this session. Please try again.');
    } finally {
      if (request === sessionsRequest.current) setRevokingSessionId(null);
    }
  };

  useEffect(() => {
    const checkStatus = async () => {
      if (!currentUser?.id) return;
      try {
        const { data, error } = await backendDb
          .from('push_tokens')
          .select('enabled')
          .eq('user_id', currentUser.id)
          .order('last_seen_at', { ascending: false })
          .limit(1);
        if (!error && data && data.length > 0) {
          setNotificationsEnabled(data[0].enabled);
        }
      } catch (err) { /* silent fallback to false */ }
    };
    checkStatus();
  }, [currentUser?.id]);

  const handleToggleNotifications = async (value: boolean) => {
    setNotificationsEnabled(value);
    if (!currentUser?.id) return;
    try {
      if (!value) {
        // Disable: mark any existing token as disabled
        await backendDb
          .from('push_tokens')
          .update({ enabled: false })
          .eq('user_id', currentUser.id);
      } else {
        // Re-enable: request permission and save fresh token
        const token = await registerForPushNotificationsAsync();
        if (!token) { setNotificationsEnabled(false); return; }
        await savePushTokenAsync(currentUser.id, token);
      }
    } catch (e) {
      console.warn('Notification toggle failed:', e);
    }
  };
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [modalState, setModalState] = useState<{
    visible: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDestructive?: boolean;
    onCancel?: () => void;
  }>({
    visible: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });
  const [legalModal, setLegalModal] = useState<{ visible: boolean; title: string; content: string }>({
    visible: false,
    title: '',
    content: ''
  });
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCheckingDeletion, setIsCheckingDeletion] = useState(false);

  const s = makeStyles(colors, isDark);

  const handleSignOut = () => {
    setModalState({
      visible: true,
      title: 'Sign Out',
      message: 'Are you sure you want to sign out of your account?',
      isDestructive: true,
      onConfirm: async () => {
        setModalState(p => ({ ...p, visible: false }));
        await signOut();
      },
      onCancel: () => setModalState(p => ({ ...p, visible: false }))
    });
  };

  const handleReset = () => {
    setModalState({
      visible: true,
      title: 'Reset Local Data',
      message: 'This will clear your local cache and preferences. Your account data remains safe on the server. Continue?',
      isDestructive: true,
      onConfirm: async () => {
        setModalState(p => ({ ...p, visible: false }));
        await resetState();
      },
      onCancel: () => setModalState(p => ({ ...p, visible: false }))
    });
  };

  const handleShareProfile = async () => {
    if (!profileLink) return;
    try {
      if (canShareProfile) {
        await Share.share({ title: `${BRAND.name} Profile`, message: profileLink });
      } else if (canCopyProfile) {
        await navigator.clipboard.writeText(profileLink);
        setModalState({
          visible: true,
          title: 'Profile Link Copied',
          message: profileLink,
          onConfirm: () => setModalState(value => ({ ...value, visible: false })),
          onCancel: () => setModalState(value => ({ ...value, visible: false })),
        });
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setModalState({
        visible: true,
        title: 'Sharing Failed',
        message: 'Could not share your profile link. Please try again.',
        onConfirm: () => setModalState(value => ({ ...value, visible: false })),
        onCancel: () => setModalState(value => ({ ...value, visible: false })),
      });
    }
  };

  const handleDeleteAccount = () => {
    setModalState({
      visible: true,
      title: 'Delete Account',
      message: 'Delete your profile, content and uploaded media? New bookings and uploads will stop. Open bookings and balances must be resolved first. Required financial records may be retained. This cannot be undone once cleanup starts.',
      isDestructive: true,
      onConfirm: async () => {
        setModalState(p => ({ ...p, visible: false }));
        try {
          setIsDeleting(true);
          const result = await requestAccountDeletion('User requested via settings');
          Alert.alert('Deletion Queued', `Request ${result.id} is ${result.status}. Your data will be removed after open bookings and balances are resolved. Your account has not yet been deleted.`);
        } catch (err) {
          Alert.alert('Error', 'Failed to submit request. Please contact support.');
        } finally {
          setIsDeleting(false);
        }
      },
      onCancel: () => setModalState(p => ({ ...p, visible: false }))
    });
  };

  const checkDeletionStatus = async () => {
    setIsCheckingDeletion(true);
    try {
      const result = await getAccountDeletionStatus();
      Alert.alert('Account Deletion', result
        ? `Request ${result.id}: ${result.status}.${result.blocked_reason ? '\nOutstanding: ' + result.blocked_reason.replace(/_/g, ' ') : ''}`
        : 'No deletion receipt is stored on this device.');
    } catch (error: any) {
      Alert.alert('Account Deletion', error.message || 'Unable to check deletion status.');
    } finally {
      setIsCheckingDeletion(false);
    }
  };

  const handleUpdateAvatar = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photos to update your avatar.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0]?.uri) {
      const pickedUri = result.assets[0].uri;
      try {
        setIsUploadingAvatar(true);
        setAvatarPreviewUri(pickedUri);
        await updateProfilePicture(pickedUri);
        setTimeout(() => setAvatarPreviewUri(null), 350);
        Alert.alert('Success', 'Profile picture updated successfully!');
      } catch (err) {
        setAvatarPreviewUri(null);
        Alert.alert('Update failed', 'Could not update your profile picture. Please try again.');
      } finally {
        setIsUploadingAvatar(false);
      }
    }
  };

  const resolvedAvatarUri =
    avatarPreviewUri ||
    currentUser?.avatar_url ||
    (typeof userMetadata?.avatar_url === 'string' ? userMetadata.avatar_url : null) ||
    PLACEHOLDER_AVATAR;

  return (
    <SafeAreaView edges={['left', 'right']} style={[s.safeArea, { backgroundColor: colors.bg }]}>
    <ScrollView contentContainerStyle={[s.container, { paddingTop: Math.max(24, insets.top + 12), paddingBottom: Math.max(40, insets.bottom + 22) }]}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Settings</Text>
      </View>
      {/* Profile Card */}
      <View style={s.profileSection}>
        <TouchableOpacity
          style={s.avatarContainer}
          onPress={handleUpdateAvatar}
          disabled={isUploadingAvatar}
          activeOpacity={0.85}
          hitSlop={{ top: 12, left: 12, right: 12, bottom: 12 }}
        >
          <Image
            key={resolvedAvatarUri || 'avatar'}
            source={{ uri: resolvedAvatarUri }}
            style={[s.profileAvatar, isUploadingAvatar && s.avatarUploading]}
          />
          <View style={s.cameraBadge}>
            <Ionicons name="camera" size={14} color="#fff" />
          </View>
        </TouchableOpacity>
        <View style={s.profileInfo}>
          <Text style={s.profileName}>
            {currentUser?.full_name ||
              (typeof userMetadata?.full_name === 'string' ? userMetadata.full_name : null) ||
              currentUser?.email?.split('@')[0] ||
              'Guest User'}
          </Text>
        </View>
        <TouchableOpacity 
          style={s.editProfileButton} 
          onPress={() => navigation.navigate('AccountConfig')}
          activeOpacity={0.85}
          hitSlop={{ top: 12, left: 12, right: 12, bottom: 12 }}
        >
          <Ionicons name="create-outline" size={20} color={colors.accent} />
          <Text style={s.editProfileText}>Edit</Text>
        </TouchableOpacity>
      </View>

      {/* APPEARANCE */}
      <View style={s.section}>
        <Text style={s.sectionHeader}>APPEARANCE</Text>
        <View style={s.group}>
          <View style={[s.groupItem, { flexDirection: 'column', alignItems: 'flex-start', paddingBottom: 16 }]}>
            <View style={s.itemLeft}>
              <View style={[s.iconContainer, { backgroundColor: '#6366f1' }]}>
                <Ionicons name="contrast" size={16} color="#fff" />
              </View>
              <Text style={s.itemText}>Theme</Text>
            </View>
            <View style={s.themeSegmented}>
              {THEME_OPTIONS.map((opt) => {
                const active = themeMode === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[s.themeOption, active && s.themeOptionActive]}
                    onPress={() => setThemeMode(opt.value)}
                  >
                    <Ionicons
                      name={opt.icon as any}
                      size={16}
                      color={active ? (isDark ? '#0f172a' : '#fff') : colors.textMuted}
                    />
                    <Text style={[s.themeOptionText, active && s.themeOptionTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </View>

      {/* PREFERENCES */}
      <View style={s.section}>
        <Text style={s.sectionHeader}>PREFERENCES</Text>
        <View style={s.group}>
          <View style={[s.groupItem, s.groupItemBorder]}>
            <View style={s.itemLeft}>
              <View style={[s.iconContainer, { backgroundColor: '#3b82f6' }]}>
                <Ionicons name="notifications" size={16} color="#fff" />
              </View>
              <Text style={s.itemText}>Push Notifications</Text>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={handleToggleNotifications}
              trackColor={{ false: colors.border, true: colors.successGreen }}
              thumbColor="#fff"
            />
          </View>
          <TouchableOpacity style={s.groupItem} onPress={() => navigation.navigate('Compliance')}>
            <View style={s.itemLeft}>
              <View style={[s.iconContainer, { backgroundColor: '#8b5cf6' }]}>
                <Ionicons name="lock-closed" size={16} color="#fff" />
              </View>
              <Text style={s.itemText}>Privacy & Permissions</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* SECURITY & ACCOUNT */}
      <View style={s.section}>
        <Text style={s.sectionHeader}>SECURITY & ACCOUNT</Text>
        <View style={s.group}>
          <View style={[s.groupItem, s.groupItemBorder]} accessibilityLabel="Biometric Lock: unavailable" accessibilityState={{ disabled: true }}>
            <View style={s.itemLeft}>
              <View style={[s.iconContainer, { backgroundColor: '#10b981' }]}>
                <Ionicons name="finger-print" size={16} color="#fff" />
              </View>
              <Text style={s.itemText}>Biometric Lock</Text>
            </View>
            <Text style={s.unavailableText}>Unavailable</Text>
          </View>
          <View style={[s.groupItem, s.groupItemBorder]} accessibilityLabel="Two-Factor Auth (2FA): unavailable" accessibilityState={{ disabled: true }}>
            <View style={s.itemLeft}>
              <View style={[s.iconContainer, { backgroundColor: '#6366f1' }]}>
                <Ionicons name="shield-checkmark" size={16} color="#fff" />
              </View>
              <Text style={s.itemText}>Two-Factor Auth (2FA)</Text>
            </View>
            <Text style={s.unavailableText}>Unavailable</Text>
          </View>
          <TouchableOpacity
            style={s.groupItem}
            accessibilityRole="button"
            accessibilityLabel="Active Sessions"
            disabled={!currentUser?.id}
            onPress={() => setSessionsVisible(true)}
          >
            <View style={s.itemLeft}>
              <View style={[s.iconContainer, { backgroundColor: '#475569' }]}>
                <Ionicons name="list" size={16} color="#fff" />
              </View>
              <Text style={s.itemText}>Active Sessions</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* DISCOVERY */}
      {profileLink && <View style={s.section}>
        <Text style={s.sectionHeader}>DISCOVERY</Text>
        <View style={s.group}>
          <View style={[s.groupItem, { paddingVertical: 20, flexDirection: 'column', alignItems: 'center' }]}>
            <Text style={[s.itemText, { marginBottom: 16 }]}>Your Profile QR Code</Text>
            <View style={{ padding: 16, backgroundColor: '#fff', borderRadius: 8 }}>
              <QRCode
                value={profileLink}
                size={140}
                color="#0f172a"
                backgroundColor="#fff"
              />
            </View>
            <TouchableOpacity
              style={s.shareProfileButton}
              accessibilityRole="button"
              accessibilityLabel={canShareProfile ? 'Share Profile Link' : canCopyProfile ? 'Copy Profile Link' : 'Sharing unavailable'}
              disabled={!canShareProfile && !canCopyProfile}
              onPress={handleShareProfile}
            >
              <Ionicons name={canShareProfile ? 'share-outline' : 'copy-outline'} size={18} color={colors.accent} />
              <Text style={{ color: colors.accent, fontWeight: '700' }}>
                {canShareProfile ? 'Share Profile Link' : canCopyProfile ? 'Copy Profile Link' : 'Sharing unavailable'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>}

      {/* ADVANCED */}
      <View style={s.section}>
        <Text style={s.sectionHeader}>ADVANCED</Text>
        <View style={s.group}>
          <View style={[s.groupItem, s.groupItemBorder]} accessibilityLabel="Language: English">
            <View style={s.itemLeft}>
              <View style={[s.iconContainer, { backgroundColor: '#94a3b8' }]}>
                <Ionicons name="language" size={16} color="#fff" />
              </View>
              <Text style={s.itemText}>Language</Text>
            </View>
            <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>English</Text>
          </View>
          <View style={s.groupItem} accessibilityLabel="Download My Data (GDPR): unavailable" accessibilityState={{ disabled: true }}>
            <View style={s.itemLeft}>
              <View style={[s.iconContainer, { backgroundColor: '#1e293b' }]}>
                <Ionicons name="download-outline" size={16} color="#fff" />
              </View>
              <Text style={s.itemText}>Download My Data (GDPR)</Text>
            </View>
            <Text style={s.unavailableText}>Unavailable</Text>
          </View>
        </View>
      </View>

      {/* SUPPORT & ABOUT */}
      <View style={s.section}>
        <Text style={s.sectionHeader}>SUPPORT & ABOUT</Text>
        <View style={s.group}>
          <TouchableOpacity style={[s.groupItem, s.groupItemBorder]} onPress={() => navigation.navigate('CreditsWallet')}>
            <View style={s.itemLeft}>
              <View style={[s.iconContainer, { backgroundColor: '#0ea5e9' }]}>
                <Ionicons name="wallet" size={16} color="#fff" />
              </View>
              <Text style={s.itemText}>{BRAND.name} Credits</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={[s.groupItem, s.groupItemBorder]} onPress={() => navigation.navigate('PaymentHistory')}>
            <View style={s.itemLeft}>
              <View style={[s.iconContainer, { backgroundColor: '#10b981' }]}>
                <Ionicons name="card" size={16} color="#fff" />
              </View>
              <Text style={s.itemText}>Payment History</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.groupItem, s.groupItemBorder]}
            onPress={() => currentUser?.id && navigation.navigate('Reviews', { photographerId: currentUser.id })}
            disabled={!currentUser?.id}
          >
            <View style={s.itemLeft}>
              <View style={[s.iconContainer, { backgroundColor: '#8b5cf6' }]}>
                <Ionicons name="star" size={16} color="#fff" />
              </View>
              <Text style={s.itemText}>Reviews</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          {isProviderAccount && (
            <TouchableOpacity style={[s.groupItem, s.groupItemBorder]} onPress={() => navigation.navigate('KYC')}>
              <View style={s.itemLeft}>
                <View style={[s.iconContainer, { backgroundColor: currentUser?.kyc_status === 'approved' ? '#22c55e' : '#f59e0b' }]}>
                  <Ionicons name={currentUser?.kyc_status === 'approved' ? 'shield-checkmark' : 'shield-outline'} size={16} color="#fff" />
                </View>
                <Text style={s.itemText}>Identity Verification (KYC)</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {currentUser?.kyc_status !== 'approved' && (
                  <View style={{ backgroundColor: '#f59e0b22', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: '#f59e0b' }}>
                    <Text style={{ color: '#f59e0b', fontSize: 10, fontWeight: '800' }}>
                      {currentUser?.kyc_status === 'submitted' ? 'PENDING' : 'REQUIRED'}
                    </Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </View>
            </TouchableOpacity>
          )}
          {isPhotographerAccount && (
            <TouchableOpacity style={[s.groupItem, s.groupItemBorder]} onPress={() => navigation.navigate('EquipmentSetup')}>
              <View style={s.itemLeft}>
                <View style={[s.iconContainer, { backgroundColor: '#c9a44a' }]}>
                  <Ionicons name="camera" size={16} color="#fff" />
                </View>
                <Text style={s.itemText}>Equipment & Tier</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
          {isModelAccount && (
            <TouchableOpacity style={[s.groupItem, s.groupItemBorder]} onPress={() => navigation.navigate('ModelServices')}>
              <View style={s.itemLeft}>
                <View style={[s.iconContainer, { backgroundColor: '#ec4899' }]}>
                  <Ionicons name="list" size={16} color="#fff" />
                </View>
                <Text style={s.itemText}>My Services & Rates</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
          {isProviderAccount && (
            <TouchableOpacity style={[s.groupItem, s.groupItemBorder]} onPress={() => navigation.navigate('PayoutMethods')}>
              <View style={s.itemLeft}>
                <View style={[s.iconContainer, { backgroundColor: '#0ea5e9' }]}>
                  <Ionicons name="wallet" size={16} color="#fff" />
                </View>
                <Text style={s.itemText}>Payout Methods</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[s.groupItem, s.groupItemBorder]} onPress={() => navigation.navigate('Support')}>
            <View style={s.itemLeft}>
              <View style={[s.iconContainer, { backgroundColor: '#f43f5e' }]}>
                <Ionicons name="help-buoy" size={16} color="#fff" />
              </View>
              <Text style={s.itemText}>Contact Support</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity 
            style={[s.groupItem, s.groupItemBorder]} 
            onPress={() => navigation.navigate('Legal', { 
              title: 'Terms of Service', 
              content: LEGAL_CONTENT.TERMS_OF_SERVICE 
            })}
          >
            <View style={s.itemLeft}>
              <View style={[s.iconContainer, { backgroundColor: '#f59e0b' }]}>
                <Ionicons name="document-text" size={16} color="#fff" />
              </View>
              <Text style={s.itemText}>Terms of Service</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity 
            style={[s.groupItem, s.groupItemBorder]}
            onPress={() => navigation.navigate('Legal', { 
              title: 'Privacy Policy', 
              content: LEGAL_CONTENT.PRIVACY_POLICY 
            })}
          >
            <View style={s.itemLeft}>
              <View style={[s.iconContainer, { backgroundColor: '#10b981' }]}>
                <Ionicons name="shield-checkmark" size={16} color="#fff" />
              </View>
              <Text style={s.itemText}>Privacy Policy</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <View style={s.groupItem}>
            <View style={s.itemLeft}>
              <View style={[s.iconContainer, { backgroundColor: '#64748b' }]}>
                <Ionicons name="information" size={16} color="#fff" />
              </View>
              <Text style={s.itemText}>App Version</Text>
            </View>
            <Text style={s.versionText}>{environment.env} • {environment.region}</Text>
          </View>
        </View>
      </View>

      {/* DESTRUCTIVE ACTIONS */}
      <View style={s.section}>
        <View style={s.group}>
          <TouchableOpacity
            style={[s.groupItem, s.groupItemBorder, { justifyContent: 'center' }]}
            onPress={handleReset}
            disabled={saving}
          >
            <Text style={s.destructiveText}>{saving ? 'Clearing...' : 'Clear Local Cache'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.groupItem, s.groupItemBorder, { justifyContent: 'center' }]}
            onPress={handleDeleteAccount}
            disabled={isDeleting}
          >
            <Text style={s.destructiveText}>{isDeleting ? 'Processing...' : 'Delete Account'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.groupItem, { justifyContent: 'center' }]} onPress={checkDeletionStatus} disabled={isCheckingDeletion}>
            <Text style={s.itemText}>{isCheckingDeletion ? 'Checking...' : 'Deletion Status'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.groupItem, { justifyContent: 'center' }]}
            onPress={handleSignOut}
          >
            <Text style={s.destructiveText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={s.footerText}>{BRAND.name} Marketplace</Text>

      <Modal
        visible={sessionsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSessionsVisible(false)}
      >
        <View style={s.modalBackdrop}>
          <View style={s.sessionsModal} accessibilityViewIsModal>
            <View style={s.sessionsHeader}>
              <Text style={s.sessionsTitle}>Active Sessions</Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close Active Sessions"
                onPress={() => setSessionsVisible(false)}
                style={s.sessionIconButton}
              >
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            {sessionsError && <Text accessibilityRole="alert" style={s.sessionsError}>{sessionsError}</Text>}
            {sessionsLoading ? (
              <ActivityIndicator accessibilityLabel="Loading sessions" color={colors.accent} style={{ margin: 24 }} />
            ) : (
              <ScrollView contentContainerStyle={{ paddingHorizontal: 20 }}>
                {!sessionsError && sessions.length === 0 && <Text style={s.sessionDetail}>No active sessions.</Text>}
                {sessions.map(session => (
                  <View key={session.id} style={s.sessionRow}>
                    <View style={s.sessionInfo}>
                      <Text style={s.sessionName}>{session.current ? 'Current Session' : 'Other Session'}</Text>
                      <Text style={s.sessionDetail}>Signed in: {formatSessionDate(session.created_at)}</Text>
                      <Text style={s.sessionDetail}>Access expires: {formatSessionDate(session.expires_at)}</Text>
                    </View>
                    {!session.current && (
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Revoke session ${session.id}`}
                        disabled={revokingSessionId !== null}
                        onPress={() => { void handleRevokeSession(session); }}
                        style={s.sessionRevokeButton}
                      >
                        {revokingSessionId === session.id ? (
                          <ActivityIndicator color={colors.destructive} />
                        ) : <Ionicons name="log-out-outline" size={22} color={colors.destructive} />}
                        <Text style={{ color: colors.destructive, fontSize: 13, fontWeight: '600' }}>Revoke</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Refresh sessions"
              disabled={sessionsLoading || revokingSessionId !== null}
              onPress={() => setSessionsRefresh(value => value + 1)}
              style={s.shareProfileButton}
            >
              <Ionicons name="refresh" size={18} color={colors.accent} />
              <Text style={{ color: colors.accent, fontWeight: '700' }}>Refresh</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      
      <ActionModal
        visible={modalState.visible}
        title={modalState.title}
        message={modalState.message}
        onConfirm={modalState.onConfirm || (() => {})}
        onCancel={modalState.onCancel || (() => {})}
        isDestructive={modalState.isDestructive}
        confirmLabel={modalState.isDestructive ? 'Confirm' : 'OK'}
      />

      <ActionModal
        visible={legalModal.visible}
        title={legalModal.title}
        message={legalModal.content}
        onConfirm={() => setLegalModal(p => ({ ...p, visible: false }))}
        onCancel={() => setLegalModal(p => ({ ...p, visible: false }))}
        confirmLabel="Close"
      />
    </ScrollView>
    </SafeAreaView>
  );
};

type Colors = ReturnType<typeof useTheme>['colors'];

const makeStyles = (colors: Colors, isDark: boolean) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    container: {
      backgroundColor: colors.bg,
      minHeight: '100%',
      paddingTop: 12,
      paddingBottom: 40,
    },
    header: {
      paddingHorizontal: 20,
      paddingBottom: 8,
    },
    headerTitle: {
      color: colors.text,
      fontSize: 66,
      lineHeight: 70,
      fontWeight: '900',
    },
    profileSection: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      marginBottom: 30,
      marginTop: 8,
    },
    avatarContainer: {
      position: 'relative',
      minWidth: 88,
      minHeight: 88,
      alignItems: 'center',
      justifyContent: 'center',
    },
    profileAvatar: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: colors.border,
    },
    avatarUploading: {
      opacity: 0.5,
    },
    cameraBadge: {
      position: 'absolute',
      bottom: 0,
      right: -4,
      backgroundColor: '#007AFF',
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.bg,
    },
    profileInfo: { marginLeft: 16, flex: 1 },
    profileName: { fontSize: 22, fontWeight: '700', color: colors.text },
    profileStatus: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
    editProfileButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
      minHeight: 44,
      minWidth: 72,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
    },
    editProfileText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.accent,
      marginLeft: 4,
    },
    section: { marginBottom: 24 },
    sectionHeader: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textMuted,
      marginLeft: 20,
      marginBottom: 10,
      letterSpacing: 0.8,
    },
    group: {
      backgroundColor: colors.card,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    groupItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      paddingRight: 16,
      paddingLeft: 20,
      minHeight: 58,
    },
    groupItemBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    itemLeft: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, marginRight: 12 },
    iconContainer: {
      width: 30,
      height: 30,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 14,
    },
    itemText: { fontSize: 17, color: colors.text, fontWeight: '600', flexShrink: 1 },
    unavailableText: { fontSize: 13, color: colors.textMuted, maxWidth: 100 },
    shareProfileButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      minHeight: 44,
      marginVertical: 8,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    sessionsModal: {
      width: '100%',
      maxWidth: 560,
      maxHeight: '85%',
      backgroundColor: colors.bg,
      borderRadius: 8,
      paddingBottom: 8,
    },
    sessionsHeader: { flexDirection: 'row', alignItems: 'center', padding: 16 },
    sessionsTitle: { fontSize: 24, fontWeight: '700', color: colors.text, flex: 1 },
    sessionsError: { color: colors.destructive, paddingHorizontal: 20, paddingBottom: 12 },
    sessionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    sessionInfo: { flex: 1 },
    sessionName: { fontSize: 16, fontWeight: '600', color: colors.text },
    sessionDetail: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
    sessionIconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    sessionRevokeButton: { width: 88, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    versionText: { fontSize: 15, color: colors.textMuted },
    destructiveText: { fontSize: 16, color: colors.destructive, fontWeight: '600' },
    footerText: { textAlign: 'center', color: colors.textMuted, fontSize: 13, marginTop: 12 },
    themeSegmented: {
      flexDirection: 'row',
      marginTop: 12,
      marginLeft: 44,
      backgroundColor: colors.bg,
      borderRadius: 12,
      padding: 3,
      gap: 4,
    },
    themeOption: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      paddingHorizontal: 10,
      borderRadius: 10,
      gap: 5,
    },
    themeOptionActive: {
      backgroundColor: isDark ? '#f8fafc' : '#111827',
    },
    themeOptionText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textMuted,
    },
    themeOptionTextActive: {
      color: isDark ? '#0f172a' : '#fff',
    },
  });

export default SettingsScreen;
