import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppData } from '../store/AppDataContext';
import { useTheme } from '../store/ThemeContext';
import { UserRole } from '../types';
import { LinearGradient } from 'expo-linear-gradient';
import { BRAND } from '../utils/constants';

const { width } = Dimensions.get('window');

const RoleSelectionScreen: React.FC = () => {
  const { updateProfile } = useAppData();
  const { colors, isDark } = useTheme();
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const roles: { id: UserRole; title: string; description: string; icon: string; color: string }[] = [
    {
      id: 'client',
      title: 'I want to Book',
      description: 'I am looking for professional photographers and models for my projects.',
      icon: 'camera',
      color: '#3b82f6',
    },
    {
      id: 'photographer',
      title: 'I am a Photographer',
      description: 'I want to offer my photography services and accept professional bookings.',
      icon: 'aperture',
      color: '#10b981',
    },
    {
      id: 'model',
      title: 'I am a Model',
      description: 'I want to showcase my portfolio and be booked for shoots or content.',
      icon: 'sparkles',
      color: '#ec4899',
    },
  ];

  const handleConfirm = async () => {
    if (!selectedRole) return;
    setIsSubmitting(true);
    try {
      await updateProfile({ role: selectedRole });
    } catch (error) {
      console.error('Failed to update role:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Welcome to {BRAND.name}</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Please select how you would like to use the platform. You can change this later in settings.
        </Text>
      </View>

      <View style={styles.roleList}>
        {roles.map((role) => (
          <TouchableOpacity
            key={role.id}
            style={[
              styles.roleCard,
              {
                backgroundColor: colors.card,
                borderColor: selectedRole === role.id ? role.color : colors.border,
                borderWidth: selectedRole === role.id ? 2 : 1,
              },
            ]}
            onPress={() => setSelectedRole(role.id)}
            activeOpacity={0.7}
          >
            <View style={[styles.iconContainer, { backgroundColor: role.color + '20' }]}>
              <Ionicons name={role.icon as any} size={28} color={role.color} />
            </View>
            <View style={styles.roleInfo}>
              <Text style={[styles.roleTitle, { color: colors.text }]}>{role.title}</Text>
              <Text style={[styles.roleDescription, { color: colors.textSecondary }]}>
                {role.description}
              </Text>
            </View>
            {selectedRole === role.id && (
              <Ionicons name="checkmark-circle" size={24} color={role.color} style={styles.checkIcon} />
            )}
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.confirmButton,
            {
              backgroundColor: selectedRole ? colors.accent : colors.border,
              opacity: isSubmitting ? 0.7 : 1,
            },
          ]}
          onPress={handleConfirm}
          disabled={!selectedRole || isSubmitting}
        >
          <Text style={[styles.confirmButtonText, { color: '#fff' }]}>
            {isSubmitting ? 'Setting up...' : 'Get Started'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 24,
    marginTop: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 22,
  },
  roleList: {
    padding: 20,
    gap: 16,
  },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  roleInfo: {
    flex: 1,
  },
  roleTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  roleDescription: {
    fontSize: 14,
    lineHeight: 18,
  },
  checkIcon: {
    marginLeft: 8,
  },
  footer: {
    padding: 24,
    marginTop: 'auto',
    marginBottom: 20,
  },
  confirmButton: {
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  confirmButtonText: {
    fontSize: 18,
    fontWeight: '700',
  },
});

export default RoleSelectionScreen;
