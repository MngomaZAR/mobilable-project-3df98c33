import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppData } from '../store/AppDataContext';
import { UserRole } from '../types';
import { BRAND } from '../utils/constants';

const RoleSelectionScreen: React.FC = () => {
  const { updateProfile } = useAppData();
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
    <SafeAreaView style={[styles.container, { backgroundColor: '#07111f' }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Welcome to {BRAND.name}</Text>
        <Text style={styles.subtitle}>
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
                backgroundColor: selectedRole === role.id ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.08)',
                borderColor: selectedRole === role.id ? role.color : 'rgba(255,255,255,0.08)',
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
              <Text style={styles.roleTitle}>{role.title}</Text>
              <Text style={styles.roleDescription}>
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
              backgroundColor: selectedRole ? '#fbbf24' : 'rgba(255,255,255,0.12)',
              opacity: isSubmitting ? 0.7 : 1,
            },
          ]}
          onPress={handleConfirm}
          disabled={!selectedRole || isSubmitting}
        >
          <Text style={styles.confirmButtonText}>
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
    color: '#f8fafc',
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 22,
    color: '#cbd5e1',
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
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
    overflow: 'hidden',
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
    color: '#f8fafc',
  },
  roleDescription: {
    fontSize: 14,
    lineHeight: 18,
    color: '#cbd5e1',
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
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
    overflow: 'hidden',
  },
  confirmButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#07111f',
  },
});

export default RoleSelectionScreen;
