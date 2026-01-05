import React from 'react';
import { FlatList, Image, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useAppData } from '../store/AppDataContext';
import { RootStackParamList } from '../navigation/types';
import { Photographer } from '../types';
import { AppLogo } from '../components/AppLogo';

type Navigation = StackNavigationProp<RootStackParamList, 'Root'>;

const HomeScreen: React.FC = () => {
  const { state, loading, error, refresh } = useAppData();
  const navigation = useNavigation<Navigation>();

  const openProfile = (photographer: Photographer) => {
    navigation.navigate('Profile', { photographerId: photographer.id });
  };

  const startBooking = (photographer: Photographer) => {
    navigation.navigate('BookingForm', { photographerId: photographer.id });
  };

  const renderItem = ({ item }: { item: Photographer }) => (
    <View style={styles.card}>
      <Image source={{ uri: item.avatar }} style={styles.avatar} />
      <View style={styles.cardContent}>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.meta}>{item.style}</Text>
        <Text style={styles.meta}>{item.location}</Text>
        <View style={styles.tagsRow}>
          {item.tags.map((tag) => (
            <View style={styles.tag} key={tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.buttonGhost} onPress={() => openProfile(item)}>
            <Text style={styles.buttonGhostText}>View profile</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.buttonPrimary} onPress={() => startBooking(item)}>
            <Text style={styles.buttonPrimaryText}>Book</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <AppLogo size={70} />
        <View style={styles.heroText}>
          <Text style={styles.title}>Find your photographer</Text>
          <Text style={styles.subtitle}>Browse curated talent and send local booking requests.</Text>
        </View>
      </View>
      <FlatList
        data={state.photographers}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
        ListEmptyComponent={
          <Text style={styles.empty}>{error ? error : 'No photographers available yet.'}</Text>
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f7f7fb',
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  heroText: {
    marginLeft: 12,
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 14,
    color: '#475569',
    marginTop: 4,
  },
  listContent: {
    paddingBottom: 120,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 12,
    marginRight: 12,
  },
  cardContent: {
    flex: 1,
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  meta: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  tag: {
    backgroundColor: '#eef2ff',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
    marginBottom: 6,
  },
  tagText: {
    fontSize: 12,
    color: '#3730a3',
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  buttonPrimary: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  buttonPrimaryText: {
    color: '#fff',
    fontWeight: '700',
  },
  buttonGhost: {
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginRight: 8,
  },
  buttonGhostText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  empty: {
    textAlign: 'center',
    marginTop: 24,
    color: '#475569',
  },
});

export default HomeScreen;
