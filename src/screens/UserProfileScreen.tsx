import React, { useMemo } from 'react';
import { FlatList, Image, StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';

type Route = RouteProp<RootStackParamList, 'UserProfile'>;

type Navigation = StackNavigationProp<RootStackParamList, 'UserProfile'>;

const UserProfileScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { state, startConversationWithUser } = useAppData();
  const photographer = useMemo(
    () => state.photographers.find((p) => p.id === params.userId) ?? params.photographer,
    [params.photographer, params.userId, state.photographers]
  );

  const posts = state.posts.filter((post) => post.userId === params.userId);

  const handleMessage = async () => {
    if (!photographer) return;
    try {
      const convo = await startConversationWithUser(photographer.id, photographer.name);
      navigation.navigate('Root', { screen: 'Chat', params: { conversationId: convo.id, title: convo.title } });
    } catch (e) {
      // handled in context
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{photographer?.name ?? 'Creator'}</Text>
      <Text style={styles.subtitle}>{photographer?.style ?? 'Visual storyteller'}</Text>
      <TouchableOpacity style={{ marginVertical: 8 }} onPress={handleMessage}>
        <Text style={{ color: '#0f172a', fontWeight: '700' }}>Message</Text>
      </TouchableOpacity>
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
