import React, { useMemo } from 'react';
import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';
import { supabase } from '../config/supabaseClient';

type Route = RouteProp<RootStackParamList, 'UserProfile'>;
type Navigation = StackNavigationProp<RootStackParamList, 'UserProfile'>;

const UserProfileScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { state, currentUser } = useAppData();
  const photographer = useMemo(
    () => state.photographers.find((p) => p.id === params.userId) ?? params.photographer,
    [params.photographer, params.userId, state.photographers]
  );

  const posts = state.posts.filter((post) => post.userId === params.userId);
  const startConversation = async () => {
    if (!currentUser?.id || currentUser.id === params.userId) return;
    const title = `Chat · ${photographer?.name ?? 'User'}`;
    const { data: existing } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', currentUser.id)
      .limit(20);
    if (existing?.length) {
      const ids = existing.map((row: any) => row.conversation_id);
      const { data: candidate } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .in('conversation_id', ids)
        .eq('user_id', params.userId)
        .maybeSingle();
      if (candidate?.conversation_id) {
        navigation.navigate('ChatThread', { conversationId: candidate.conversation_id, title });
        return;
      }
    }
    const { data: convo } = await supabase
      .from('conversations')
      .insert({
        title,
        created_by: currentUser.id,
        last_message: 'Say hello 👋',
        last_message_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (convo?.id) {
      await supabase.from('conversation_participants').insert([
        { conversation_id: convo.id, user_id: currentUser.id },
        { conversation_id: convo.id, user_id: params.userId },
      ]);
      navigation.navigate('ChatThread', { conversationId: convo.id, title });
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{photographer?.name ?? 'Creator'}</Text>
      <Text style={styles.subtitle}>{photographer?.style ?? 'Visual storyteller'}</Text>
      <TouchableOpacity
        style={styles.reportButton}
        onPress={() =>
          navigation.navigate('Report', {
            targetType: 'user',
            targetId: params.userId,
            title: photographer?.name ?? 'User',
          })
        }
      >
        <Text style={styles.reportText}>Report user</Text>
      </TouchableOpacity>
      {currentUser?.id && currentUser.id !== params.userId ? (
        <TouchableOpacity style={styles.chatButton} onPress={startConversation}>
          <Text style={styles.chatButtonText}>Start conversation</Text>
        </TouchableOpacity>
      ) : null}
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
  reportButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#fee2e2',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  reportText: {
    color: '#991b1b',
    fontWeight: '700',
  },
  chatButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  chatButtonText: {
    color: '#0f172a',
    fontWeight: '700',
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
