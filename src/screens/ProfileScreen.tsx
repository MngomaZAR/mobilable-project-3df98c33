import React, { useMemo } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useAppData } from '../store/AppDataContext';
import { RootStackParamList } from '../navigation/types';
import { Photographer } from '../types';

type Navigation = StackNavigationProp<RootStackParamList, 'Profile'>;
type Route = RouteProp<RootStackParamList, 'Profile'>;

const ProfileScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { state } = useAppData();
  const photographer = useMemo(
    () => state.photographers.find((item) => item.id === params.photographerId),
    [params.photographerId, state.photographers]
  );

  if (!photographer) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>We could not find that photographer.</Text>
      </View>
    );
  }

  const openBooking = () => navigation.navigate('BookingForm', { photographerId: photographer.id });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Image source={{ uri: photographer.avatar }} style={styles.hero} />
      <Text style={styles.title}>{photographer.name}</Text>
      <Text style={styles.subtitle}>{photographer.style}</Text>
      <Text style={styles.meta}>{photographer.location}</Text>
      <View style={styles.tagsRow}>
        {photographer.tags.map((tag) => (
          <View key={tag} style={styles.tag}>
            <Text style={styles.tagText}>{tag}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.bio}>{photographer.bio}</Text>
      <View style={styles.pillRow}>
        <View style={styles.pill}>
          <Text style={styles.pillLabel}>Rating</Text>
          <Text style={styles.pillValue}>{photographer.rating.toFixed(1)} / 5</Text>
        </View>
        <View style={styles.pill}>
          <Text style={styles.pillLabel}>Budget</Text>
          <Text style={styles.pillValue}>{photographer.priceRange}</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.cta} onPress={openBooking}>
        <Text style={styles.ctaText}>Request booking</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#f7f7fb',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  muted: {
    color: '#475569',
  },
  hero: {
    width: '100%',
    height: 260,
    borderRadius: 16,
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 16,
    color: '#475569',
    marginTop: 4,
  },
  meta: {
    fontSize: 14,
    color: '#475569',
    marginTop: 2,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginVertical: 12,
  },
  tag: {
    backgroundColor: '#eef2ff',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 6,
    marginBottom: 6,
  },
  tagText: {
    color: '#312e81',
    fontWeight: '600',
  },
  bio: {
    fontSize: 15,
    color: '#1f2937',
    lineHeight: 22,
    marginBottom: 16,
  },
  pillRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  pill: {
    flex: 1,
    backgroundColor: '#fff',
    marginRight: 10,
    borderRadius: 14,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  pillLabel: {
    fontSize: 12,
    color: '#6b7280',
  },
  pillValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 4,
  },
  cta: {
    backgroundColor: '#0f172a',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  ctaText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
});

export default ProfileScreen;
