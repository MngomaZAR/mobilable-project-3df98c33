import React, { useState, useEffect } from 'react';
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
  Linking,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import QRCode from 'react-native-qrcode-svg';
import * as WebBrowser from 'expo-web-browser';
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
import { requestAccountDeletion } from '../services/accountService';
import { PLACEHOLDER_AVATAR } from '../utils/constants';
import { supabase } from '../config/supabaseClient';
import { registerForPushNotificationsAsync, savePushTokenAsync } from '../services/notificationService';

type Navigation = StackNavigationProp<RootStackParamList, 'Root'>;

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
  const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [language, setLanguage] = useState('English');
  const [avatarPreviewUri, setAvatarPreviewUri] = useState<string | null>(null);
  const showDevVideoTools = __DEV__ || environment.env !== 'production';

  useEffect(() => {
    const checkStatus = async () => {
      if (!currentUser?.id) return;
      try {
        const { data, error } = await supabase
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
        await supabase
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

  const handleToggleBiometrics = async (value: boolean) => {
    if (value) {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      if (!hasHardware) {
        Alert.alert('Not Supported', 'Your device does not support biometric authentication.');
        return;
      }
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!isEnrolled) {
        Alert.alert('Not Enrolled', 'Please set up FaceID or Fingerprint in your device settings first.');
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Enable Biometric Lock',
        fallbackLabel: 'Enter Passcode',
      });
      if (result.success) {
        setBiometricsEnabled(true);
        Alert.alert('Enabled', 'Biometric lock will be required when opening the app.');
      }
    } else {
      setBiometricsEnabled(false);
    }
  };

  const handleOpen2FA = () => {
    WebBrowser.openBrowserAsync('https://supabase.com/dashboard/project/_/auth/mfa');
  };

  const handleDownloadData = () => {
     Alert.alert('Request Data Export', 'A copy of your data will be emailed to you within 24 hours.');
  };

  const handleDeleteAccount = () => {
    setModalState({
      visible: true,
      title: 'Request Account Deletion',
      message: 'This will submit a formal request to delete your account and all associated data. This action is permanent. Continue?',
      isDestructive: true,
      onConfirm: async () => {
        setModalState(p => ({ ...p, visible: false }));
        try {
          setIsDeleting(true);
          await requestAccountDeletion('User requested via settings');
          Alert.alert('Request Sent', 'Your account deletion request has been submitted and will be processed within 30 days.');
        } catch (err) {
          Alert.alert('Error', 'Failed to submit request. Please contact support.');
        } finally {
          setIsDeleting(false);
        }
      },
      onCancel: () => setModalState(p => ({ ...p, visible: false }))
    });
  };

  const handleTestVideoCall = () => {
    if (!currentUser?.id) {
      Alert.alert('Not ready', 'Please sign in before starting a test call.');
      return;
    }
    if (currentUser.role !== 'model') {
      Alert.alert('Unavailable', 'Video hosting is currently available for model accounts only.');
      return;
    }
    navigation.navigate('PaidVideoCall', { creatorId: currentUser.id, role: 'creator' });
  };

  const handleOpenTestRoom = () => {
    navigation.navigate('PaidVideoCall', { testRoom: true, role: 'viewer' });
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
    (currentUser as any)?.user_metadata?.avatar_url ||
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
              (currentUser as any)?.user_metadata?.full_name ||
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
          <View style={[s.groupItem, s.groupItemBorder]}>
            <View style={s.itemLeft}>
              <View style={[s.iconContainer, { backgroundColor: '#10b981' }]}>
                <Ionicons name="finger-print" size={16} color="#fff" />
              </View>
              <Text style={s.itemText}>Biometric Lock</Text>
            </View>
            <Switch
              value={biometricsEnabled}
              onValueChange={handleToggleBiometrics}
              trackColor={{ false: colors.border, true: colors.successGreen }}
              thumbColor="#fff"
            />
          </View>
          <TouchableOpacity style={[s.groupItem, s.groupItemBorder]} onPress={handleOpen2FA}>
            <View style={s.itemLeft}>
              <View style={[s.iconContainer, { backgroundColor: '#6366f1' }]}>
                <Ionicons name="shield-checkmark" size={16} color="#fff" />
              </View>
              <Text style={s.itemText}>Two-Factor Auth (2FA)</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={s.groupItem} onPress={() => Alert.alert('Sessions', 'Showing active login sessions...')}>
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
      <View style={s.section}>
        <Text style={s.sectionHeader}>DISCOVERY</Text>
        <View style={s.group}>
          <View style={[s.groupItem, { paddingVertical: 20, flexDirection: 'column', alignItems: 'center' }]}>
            <Text style={[s.itemText, { marginBottom: 16 }]}>Your Profile QR Code</Text>
            <View style={{ padding: 16, backgroundColor: '#fff', borderRadius: 16 }}>
              <QRCode
                value={`papzi://profile/${currentUser?.id}`}
                size={140}
                color="#0f172a"
                backgroundColor="#fff"
              />
            </View>
            <TouchableOpacity style={{ marginTop: 16 }} onPress={() => {}}>
              <Text style={{ color: colors.accent, fontWeight: '700' }}>Share QR Code</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* ADVANCED */}
      <View style={s.section}>
        <Text style={s.sectionHeader}>ADVANCED</Text>
        <View style={s.group}>
          <TouchableOpacity style={[s.groupItem, s.groupItemBorder]} onPress={() => {
            Alert.alert('Select Language', 'Choose your preferred language', [
              { text: 'English', onPress: () => setLanguage('English') },
              { text: 'Zulu (isiZulu)', onPress: () => setLanguage('Zulu (isiZulu)') },
              { text: 'Afrikaans', onPress: () => setLanguage('Afrikaans') },
              { text: 'Cancel', style: 'cancel' },
            ]);
          }}>
            <View style={s.itemLeft}>
              <View style={[s.iconContainer, { backgroundColor: '#94a3b8' }]}>
                <Ionicons name="language" size={16} color="#fff" />
              </View>
              <Text style={s.itemText}>Language</Text>
            </View>
            <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>{language}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.groupItem} onPress={handleDownloadData}>
            <View style={s.itemLeft}>
              <View style={[s.iconContainer, { backgroundColor: '#1e293b' }]}>
                <Ionicons name="download-outline" size={16} color="#fff" />
              </View>
              <Text style={s.itemText}>Download My Data (GDPR)</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
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
              <Text style={s.itemText}>Papzi Credits</Text>
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
          {(currentUser?.role === 'model' || currentUser?.role === 'photographer') && (
            <TouchableOpacity style={[s.groupItem, s.groupItemBorder]} onPress={() => (navigation as any).navigate('KYC')}>
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
          {currentUser?.role === 'photographer' && (
            <TouchableOpacity style={[s.groupItem, s.groupItemBorder]} onPress={() => (navigation as any).navigate('EquipmentSetup')}>
              <View style={s.itemLeft}>
                <View style={[s.iconContainer, { backgroundColor: '#c9a44a' }]}>
                  <Ionicons name="camera" size={16} color="#fff" />
                </View>
                <Text style={s.itemText}>Equipment & Tier</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
          {currentUser?.role === 'model' && (
            <TouchableOpacity style={[s.groupItem, s.groupItemBorder]} onPress={() => (navigation as any).navigate('ModelServices')}>
              <View style={s.itemLeft}>
                <View style={[s.iconContainer, { backgroundColor: '#ec4899' }]}>
                  <Ionicons name="list" size={16} color="#fff" />
                </View>
                <Text style={s.itemText}>My Services & Rates</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
          {(currentUser?.role === 'model' || currentUser?.role === 'photographer') && (
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

      {showDevVideoTools && (
        <View style={s.section}>
          <Text style={s.sectionHeader}>VIDEO CALL</Text>
          <View style={s.group}>
            {currentUser?.role === 'model' && (
              <TouchableOpacity style={[s.groupItem, s.groupItemBorder]} onPress={handleTestVideoCall}>
                <View style={s.itemLeft}>
                  <View style={[s.iconContainer, { backgroundColor: '#3b82f6' }]}>
                    <Ionicons name="videocam" size={16} color="#fff" />
                  </View>
                  <Text style={s.itemText}>Start Test Call (Model Host)</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.groupItem} onPress={handleOpenTestRoom}>
              <View style={s.itemLeft}>
                <View style={[s.iconContainer, { backgroundColor: '#ec4899' }]}>
                  <Ionicons name="people" size={16} color="#fff" />
                </View>
                <Text style={s.itemText}>LiveKit Test Room (2-User)</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      )}

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
          <TouchableOpacity
            style={[s.groupItem, { justifyContent: 'center' }]}
            onPress={handleSignOut}
          >
            <Text style={s.destructiveText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={s.footerText}>Papzi Marketplace</Text>
      
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
    itemLeft: { flexDirection: 'row', alignItems: 'center' },
    iconContainer: {
      width: 30,
      height: 30,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 14,
    },
    itemText: { fontSize: 17, color: colors.text, fontWeight: '600' },
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
