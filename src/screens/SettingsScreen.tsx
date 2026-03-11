import React, { useState } from 'react';
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
  Platform,
} from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAppData } from '../store/AppDataContext';
import { useTheme, ThemeMode } from '../store/ThemeContext';
import { environment } from '../config/environment';
import { RootStackParamList } from '../navigation/types';
import { ActionModal } from '../components/ActionModal';
import { LEGAL_CONTENT } from '../constants/LegalContent';
import { requestAccountDeletion } from '../services/accountService';
import { PLACEHOLDER_AVATAR } from '../utils/constants';

type Navigation = StackNavigationProp<RootStackParamList, 'Root'>;

const THEME_OPTIONS: { label: string; value: ThemeMode; icon: string }[] = [
  { label: 'Light', value: 'light', icon: 'sunny' },
  { label: 'Dark', value: 'dark', icon: 'moon' },
  { label: 'Auto', value: 'system', icon: 'phone-portrait' },
];

const SettingsScreen: React.FC = () => {
  const { resetState, saving, currentUser, signOut, updateProfilePicture } = useAppData();
  const { colors, isDark, themeMode, setThemeMode } = useTheme();
  const navigation = useNavigation<Navigation>();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
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
      try {
        setIsUploadingAvatar(true);
        await updateProfilePicture(result.assets[0].uri);
        Alert.alert('Success', 'Profile picture updated successfully!');
      } catch (err) {
        // error handled in context
      } finally {
        setIsUploadingAvatar(false);
      }
    }
  };

  return (
    <ScrollView contentContainerStyle={s.container}>
      {/* Profile Card */}
      <View style={s.profileSection}>
        <TouchableOpacity style={s.avatarContainer} onPress={handleUpdateAvatar} disabled={isUploadingAvatar}>
          <Image
            source={{ uri: currentUser?.avatar_url || (currentUser as any)?.user_metadata?.avatar_url || PLACEHOLDER_AVATAR }}
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
              onValueChange={setNotificationsEnabled}
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

      {/* SUPPORT & ABOUT */}
      <View style={s.section}>
        <Text style={s.sectionHeader}>SUPPORT & ABOUT</Text>
        <View style={s.group}>
          <TouchableOpacity style={[s.groupItem, s.groupItemBorder]} onPress={() => navigation.navigate('PaymentHistory')}>
            <View style={s.itemLeft}>
              <View style={[s.iconContainer, { backgroundColor: '#10b981' }]}>
                <Ionicons name="card" size={16} color="#fff" />
              </View>
              <Text style={s.itemText}>Payment History</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
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
  );
};

type Colors = ReturnType<typeof useTheme>['colors'];

const makeStyles = (colors: Colors, isDark: boolean) =>
  StyleSheet.create({
    container: {
      backgroundColor: colors.bg,
      minHeight: '100%',
      paddingTop: 16,
      paddingBottom: 40,
    },
    profileSection: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      marginBottom: 32,
      marginTop: 10,
    },
    avatarContainer: {
      position: 'relative',
    },
    profileAvatar: {
      width: 64,
      height: 64,
      borderRadius: 32,
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
      backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 16,
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
      fontSize: 13,
      fontWeight: '600',
      color: colors.textMuted,
      marginLeft: 20,
      marginBottom: 8,
      letterSpacing: 0.5,
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
      paddingVertical: 12,
      paddingRight: 16,
      paddingLeft: 20,
      minHeight: 52,
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
    itemText: { fontSize: 16, color: colors.text },
    versionText: { fontSize: 15, color: colors.textMuted },
    destructiveText: { fontSize: 16, color: colors.destructive, fontWeight: '600' },
    footerText: { textAlign: 'center', color: colors.textMuted, fontSize: 13, marginTop: 12 },
    themeSegmented: {
      flexDirection: 'row',
      marginTop: 12,
      marginLeft: 44,
      backgroundColor: colors.bg,
      borderRadius: 10,
      padding: 3,
      gap: 4,
    },
    themeOption: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 8,
      gap: 5,
    },
    themeOptionActive: {
      backgroundColor: isDark ? '#f8fafc' : '#111827',
    },
    themeOptionText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textMuted,
    },
    themeOptionTextActive: {
      color: isDark ? '#0f172a' : '#fff',
    },
  });

export default SettingsScreen;
