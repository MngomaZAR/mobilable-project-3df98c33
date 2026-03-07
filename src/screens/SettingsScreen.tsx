import React, { useState } from 'react';
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

type Navigation = StackNavigationProp<RootStackParamList, 'Root'>;
const PLACEHOLDER_AVATAR =
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=300&q=80';

const THEME_OPTIONS: { label: string; value: ThemeMode; icon: string }[] = [
  { label: 'Light', value: 'light', icon: 'sunny' },
  { label: 'Dark', value: 'dark', icon: 'moon' },
  { label: 'Auto', value: 'system', icon: 'phone-portrait' },
];

const SettingsScreen: React.FC = () => {
  const { resetState, saving, currentUser, signOut } = useAppData();
  const { colors, isDark, themeMode, setThemeMode } = useTheme();
  const navigation = useNavigation<Navigation>();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  const s = makeStyles(colors, isDark);

  const handleSignOut = async () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Are you sure you want to sign out?')) {
        signOut();
      }
      return;
    }
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const handleReset = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('This will clear your local cache. Continue?')) {
        resetState();
      }
      return;
    }
    Alert.alert('Reset Data', 'This will clear your local cache. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: resetState },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={s.container}>
      {/* Profile Card */}
      <View style={s.profileSection}>
        <Image
          source={{ uri: (currentUser as any)?.user_metadata?.avatar_url || PLACEHOLDER_AVATAR }}
          style={s.profileAvatar}
        />
        <View style={s.profileInfo}>
          <Text style={s.profileName}>
            {(currentUser as any)?.user_metadata?.full_name ||
              currentUser?.email?.split('@')[0] ||
              'Guest User'}
          </Text>
          <Text style={s.profileEmail}>
            {currentUser?.email || 'Sign in to access your account'}
          </Text>
        </View>
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
          <TouchableOpacity style={[s.groupItem, s.groupItemBorder]}>
            <View style={s.itemLeft}>
              <View style={[s.iconContainer, { backgroundColor: '#f59e0b' }]}>
                <Ionicons name="document-text" size={16} color="#fff" />
              </View>
              <Text style={s.itemText}>Terms of Service</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={[s.groupItem, s.groupItemBorder]}>
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
            style={[s.groupItem, { justifyContent: 'center' }]}
            onPress={handleSignOut}
          >
            <Text style={s.destructiveText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={s.footerText}>Papzi Marketplace</Text>
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
    profileAvatar: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.border,
    },
    profileInfo: { marginLeft: 16, flex: 1 },
    profileName: { fontSize: 22, fontWeight: '700', color: colors.text },
    profileEmail: { fontSize: 15, color: colors.textMuted, marginTop: 4 },
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
