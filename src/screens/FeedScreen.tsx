import React from 'react';
import { FlatList, Image, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useAppData } from '../store/AppDataContext';
import { RootStackParamList } from '../navigation/types';
import { Post } from '../types';

type Navigation = StackNavigationProp<RootStackParamList, 'PostDetail'>;

const FeedScreen: React.FC = () => {
  const { state, toggleLike, refresh } = useAppData();
  const navigation = useNavigation<Navigation>();
  const [refreshing, setRefreshing] = React.useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const renderItem = ({ item }: { item: Post }) => (
    <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('PostDetail', { postId: item.id })}>
      <Image source={{ uri: item.imageUri }} style={styles.image} />
      <View style={styles.cardContent}>
        <Text style={styles.caption}>{item.caption}</Text>
        {item.location ? <Text style={styles.meta}>{item.location}</Text> : null}
        <View style={styles.actions}>
          <TouchableOpacity onPress={() => toggleLike(item.id)}>
            <Text style={styles.action}>{item.liked ? '♥️' : '♡'} {item.likes}</Text>
          </TouchableOpacity>
          <Text style={styles.action}>💬 {item.commentCount}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Social feed</Text>
        <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('CreatePost')}>
          <Text style={styles.buttonText}>New Post</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={state.posts}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>Share your first post.</Text>}
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
  },
  button: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
  },
  listContent: {
    paddingBottom: 120,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginBottom: 14,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  image: {
    width: '100%',
    height: 220,
  },
  cardContent: {
    padding: 12,
  },
  caption: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  meta: {
    color: '#6b7280',
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  action: {
    fontWeight: '700',
    color: '#111827',
  },
  empty: {
    textAlign: 'center',
    marginTop: 20,
    color: '#475569',
  },
});

export default FeedScreen;
