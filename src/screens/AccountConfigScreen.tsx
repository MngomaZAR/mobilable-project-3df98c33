import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Image,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAppData } from '../store/AppDataContext';
import { useTheme } from '../store/ThemeContext';
import { AppUser } from '../types';
import { PLACEHOLDER_AVATAR } from '../utils/constants';



const AccountConfigScreen: React.FC = () => {
  const { currentUser, updateProfile, updateProfilePicture, saving } = useAppData();
  const { colors, isDark } = useTheme();
  const navigation = useNavigation();

  // State for form fields
  const [fullName, setFullName] = useState(currentUser?.full_name || '');
  const [bio, setBio] = useState(currentUser?.bio || '');
  const [phone, setPhone] = useState(currentUser?.phone || '');
  const [city, setCity] = useState(currentUser?.city || '');
  const [instagram, setInstagram] = useState(currentUser?.instagram || currentUser?.contact_details?.instagram || '');
  const [website, setWebsite] = useState(currentUser?.website || currentUser?.contact_details?.website || '');
  
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const s = makeStyles(colors, isDark);

  const handleSave = async () => {
    try {
      const changes: Partial<AppUser> = {
        full_name: fullName,
        bio: bio,
        phone: phone,
        city: city,
        instagram: instagram,
        website: website,
        contact_details: {
          instagram: instagram,
          website: website,
        },
      };

      await updateProfile(changes);
      Alert.alert('Success', 'Profile updated successfully!');
      navigation.goBack();
    } catch (err) {
      Alert.alert('Error', 'Failed to update profile. Please try again.');
    }
  };

  const handleUpdateAvatar = async () => {
    const { status: permissionStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permissionStatus !== 'granted') {
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
      } catch (err) {
        // Handled in context
      } finally {
        setIsUploadingAvatar(false);
      }
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Edit Profile</Text>
        <TouchableOpacity onPress={handleSave} disabled={saving} style={s.saveButton}>
          {saving ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Text style={s.saveButtonText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
        {/* Avatar Section */}
        <View style={s.avatarSection}>
          <TouchableOpacity style={s.avatarWrapper} onPress={handleUpdateAvatar} disabled={isUploadingAvatar}>
            <Image
              key={currentUser?.avatar_url || 'avatar'}
              source={{ uri: currentUser?.avatar_url || PLACEHOLDER_AVATAR }}
              style={[s.avatar, isUploadingAvatar && { opacity: 0.5 }]}
            />
            {isUploadingAvatar && (
              <View style={s.avatarLoader}>
                <ActivityIndicator color="#fff" />
              </View>
            )}
            <View style={s.editBadge}>
              <Ionicons name="camera" size={16} color="#fff" />
            </View>
          </TouchableOpacity>
          <Text style={s.avatarHint}>Tap to change photo</Text>
        </View>

        {/* Form Sections */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>PERSONAL INFORMATION</Text>
          
          <View style={s.inputGroup}>
            <Text style={s.label}>Full Name</Text>
            <TextInput
              style={s.input}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Your full name"
              placeholderTextColor={colors.textMuted}
            />
          </View>


          <View style={s.inputGroup}>
            <Text style={s.label}>Bio</Text>
            <TextInput
              style={[s.input, s.multilineInput]}
              value={bio}
              onChangeText={setBio}
              placeholder="Tell about yourself..."
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={4}
            />
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>CONTACT & LOCATION</Text>
          
          <View style={s.inputGroup}>
            <Text style={s.label}>Location (City)</Text>
            <TextInput
              style={s.input}
              value={city}
              onChangeText={setCity}
              placeholder="e.g. Johannesburg"
              placeholderTextColor={colors.textMuted}
            />
          </View>

          <View style={s.inputGroup}>
            <Text style={s.label}>Phone Number</Text>
            <TextInput
              style={s.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+27..."
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
            />
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>SOCIAL CHANNELS</Text>
          
          <View style={s.inputGroup}>
            <View style={s.labelRow}>
              <Ionicons name="logo-instagram" size={16} color={colors.textMuted} style={{ marginRight: 6 }} />
              <Text style={s.label}>Instagram Username</Text>
            </View>
            <TextInput
              style={s.input}
              value={instagram}
              onChangeText={setInstagram}
              placeholder="@username"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
            />
          </View>

          <View style={s.inputGroup}>
            <View style={s.labelRow}>
              <Ionicons name="globe-outline" size={16} color={colors.textMuted} style={{ marginRight: 6 }} />
              <Text style={s.label}>Portfolio Website</Text>
            </View>
            <TextInput
              style={s.input}
              value={website}
              onChangeText={setWebsite}
              placeholder="https://..."
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              keyboardType="url"
            />
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const makeStyles = (colors: any, isDark: boolean) =>
  StyleSheet.create({
    container: {
      padding: 20,
      backgroundColor: colors.bg,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: Platform.OS === 'ios' ? 50 : 20,
      paddingBottom: 15,
      backgroundColor: colors.bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    backButton: {
      padding: 4,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    saveButton: {
      paddingVertical: 6,
      paddingHorizontal: 12,
    },
    saveButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.accent,
    },
    avatarSection: {
      alignItems: 'center',
      marginBottom: 30,
    },
    avatarWrapper: {
      position: 'relative',
    },
    avatar: {
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: colors.border,
    },
    avatarLoader: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.3)',
      borderRadius: 50,
    },
    editBadge: {
      position: 'absolute',
      bottom: 0,
      right: 0,
      backgroundColor: colors.accent,
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 3,
      borderColor: colors.bg,
    },
    avatarHint: {
      marginTop: 10,
      fontSize: 14,
      color: colors.textMuted,
    },
    section: {
      marginBottom: 32,
    },
    sectionTitle: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textMuted,
      marginBottom: 16,
      letterSpacing: 1,
    },
    inputGroup: {
      marginBottom: 20,
    },
    labelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
    },
    label: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.text,
      marginBottom: 8,
    },
    input: {
      backgroundColor: colors.card,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      fontSize: 16,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
    },
    multilineInput: {
      minHeight: 100,
      textAlignVertical: 'top',
      paddingTop: 12,
    },
  });

export default AccountConfigScreen;
