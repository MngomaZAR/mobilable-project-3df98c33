import React, { useMemo } from 'react';
import { FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';

type Route = RouteProp<RootStackParamList, 'UserProfile'>;

const UserProfileScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const { state } = useAppData();
  const photographer = useMemo(
    () => state.photographers.find((p) => p.id === params.userId) ?? params.photographer,
    [params.photographer, params.userId, state.photographers]
  );

  const posts = state.posts.filter((post) => post.userId === params.userId);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{photographer?.name ?? 'Creator'}</Text>
      <Text style={styles.subtitle}>{photographer?.style ?? 'Visual storyteller'}</Text>
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => <Image source={{ uri: item.imageUri }} style={styles.image} />}
        ListEmptyComponent={<Text style={styles.empty}>No posts yet.</Text>}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f7fb',
    padding: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    color: '#475569',
    marginBottom: 12,
  },
  row: {
    justifyContent: 'space-between',
  },
  listContent: {
    paddingBottom: 40,
  },
  image: {
    width: '48%',
    aspectRatio: 1,
    borderRadius: 12,
    marginBottom: 12,
  },
  empty: {
    textAlign: 'center',
    color: '#6b7280',
    marginTop: 20,
  },
});

export default UserProfileScreen;
