import React, { useMemo } from 'react';
import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';

type Navigation = StackNavigationProp<RootStackParamList, 'CreatePost'>;

const PhotographerPortfolioScreen: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const { state, currentUser } = useAppData();
  const posts = useMemo(
    () => state.posts.filter((post) => post.userId === currentUser?.id),
    [currentUser?.id, state.posts]
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Portfolio</Text>
        <TouchableOpacity style={styles.cta} onPress={() => navigation.navigate('CreatePost')}>
          <Text style={styles.ctaText}>New post</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => <Image source={{ uri: item.imageUri }} style={styles.image} />}
        ListEmptyComponent={<Text style={styles.empty}>No portfolio posts yet.</Text>}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f7fb', padding: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  cta: { backgroundColor: '#0f172a', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  ctaText: { color: '#fff', fontWeight: '700' },
  row: { justifyContent: 'space-between' },
  listContent: { paddingBottom: 80 },
  image: { width: '48%', aspectRatio: 1, borderRadius: 12, marginBottom: 12 },
  empty: { color: '#6b7280', textAlign: 'center', marginTop: 24 },
});

export default PhotographerPortfolioScreen;
