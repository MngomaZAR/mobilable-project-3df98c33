import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Image,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useAppData } from '../store/AppDataContext';
import { StackNavigationProp } from '@react-navigation/stack';
import { supabase, hasSupabase } from '../config/supabaseClient';
import { RootStackParamList } from '../navigation/types';

type Navigation = StackNavigationProp<RootStackParamList, 'Root'>;

type ConversationRow = {
  id: string;
  title: string | null;
  last_message: string | null;
  last_message_at: string | null;
  created_at: string | null;
};

type Conversation = {
  id: string;
  title: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  participants?: string[];
};

const ConversationsListScreen: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const { state: appState } = useAppData();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mapConversation = useCallback((row: ConversationRow): Conversation => {
    const createdAt = row.created_at ?? new Date().toISOString();
    return {
      id: row.id,
      title: row.title ?? 'Conversation',
      lastMessage: row.last_message,
      lastMessageAt: row.last_message_at ?? row.created_at,
      createdAt,
    };
  }, []);

  const fetchConversations = useCallback(async () => {
    setError(null);

    if (!hasSupabase) {
      setError('Chat is temporarily unavailable. Please try again later.');
      setConversations(appState.conversations as any);
      return;
    }

    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user?.id) {
        setConversations([]);
        return;
      }
      const currentUserId = authData.user.id;

      const { data: myParticipants, error: participantError } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', currentUserId);

      if (participantError) throw participantError;

      const conversationIds = Array.from(
        new Set((myParticipants ?? []).map((row: any) => row.conversation_id).filter(Boolean))
      );
      if (conversationIds.length === 0) {
        setConversations([]);
        return;
      }

      const { data, error: conversationsError } = await supabase
        .from('conversations')
        .select('id, title, last_message, last_message_at, created_at')
        .in('id', conversationIds)
        .order('last_message_at', { ascending: false })
        .order('created_at', { ascending: false });

      if (conversationsError) throw conversationsError;

      const { data: allParticipants } = await supabase
        .from('conversation_participants')
        .select('conversation_id, user_id')
        .in('conversation_id', conversationIds);

      const participantsMap: Record<string, string[]> = {};
      (allParticipants ?? []).forEach((row: any) => {
        const cid = row.conversation_id as string;
        participantsMap[cid] = participantsMap[cid] ? [...participantsMap[cid], row.user_id] : [row.user_id];
      });

      const mapped = (data ?? [])
        .map(mapConversation)
        .map((conversation: Conversation) => ({
          ...conversation,
          participants: participantsMap[conversation.id] ?? undefined,
        }));

      // Friendly 1:1 title fallback
      const convoWithoutTitleOtherIds: Record<string, string> = {};
      mapped.forEach((conversation) => {
        if (
          (!conversation.title || conversation.title === 'Conversation') &&
          conversation.participants &&
          conversation.participants.length === 2
        ) {
          const other = conversation.participants.find((id) => id !== currentUserId);
          if (other) convoWithoutTitleOtherIds[conversation.id] = other;
        }
      });

      const otherIds = Object.values(convoWithoutTitleOtherIds);
      if (otherIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', otherIds);
        const nameMap: Record<string, string> = {};
        (profiles ?? []).forEach((profile: any) => {
          nameMap[profile.id] = profile.full_name ?? 'Creator';
        });
        mapped.forEach((conversation) => {
          const otherId = convoWithoutTitleOtherIds[conversation.id];
          if (otherId && nameMap[otherId]) {
            conversation.title = nameMap[otherId];
          }
        });
      }

      setConversations(mapped);
    } catch (err: any) {
      const raw = String(err?.message ?? err);
      const lower = raw.toLowerCase();
      const message =
        /failed to fetch/i.test(raw) || lower.includes('network') || lower.includes('typeerror')
          ? 'Unable to connect to chat right now. Check your connection and try again.'
          : raw;
      setError(message);
    }
  }, [appState.conversations, mapConversation]);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      const load = async () => {
        setLoading(true);
        await fetchConversations();
        if (isActive) setLoading(false);
        setRefreshing(false);
      };
      load();

      return () => {
        isActive = false;
      };
    }, [fetchConversations])
  );

  // Keep local list in sync with context when Supabase is not configured
  useEffect(() => {
    if (!hasSupabase) setConversations(appState.conversations as any);
  }, [appState.conversations]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchConversations();
    setRefreshing(false);
  }, [fetchConversations]);

  const handleNewChat = useCallback(() => {
    setError('Open a photographer profile and tap Message to start a new conversation.');
    navigation.navigate('Root', { screen: 'Feed' });
  }, [navigation]);

  const listHeader = useMemo(
    () => (
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Conversations</Text>
          <Text style={styles.subtitle}>Keep your conversations in one place.</Text>
        </View>
        <TouchableOpacity style={styles.primaryButton} onPress={handleNewChat}>
          <Text style={styles.primaryButtonText}>Find photographer</Text>
        </TouchableOpacity>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    ),
    [error, handleNewChat]
  );

  const PLACEHOLDER_AVATAR = 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=300&q=80';

  const getConversationDisplayInfo = (item: Conversation) => {
    const currentUserId = appState.currentUser?.id;
    let displayTitle = item.title;
    let avatarUrl = PLACEHOLDER_AVATAR;

    if ((!displayTitle || displayTitle === 'Conversation') && item.participants && item.participants.length === 2 && currentUserId) {
      const otherId = item.participants.find((id) => id !== currentUserId);
      if (otherId) {
        const found = appState.photographers.find((p) => p.id === otherId);
        if (found) {
          displayTitle = found.name;
          avatarUrl = found.avatar;
        }
      }
    }

    return { displayTitle, avatarUrl };
  };



  const renderItem = ({ item }: { item: Conversation }) => {
    const timestamp = item.lastMessageAt ?? item.createdAt;
    const formatted = timestamp ? new Date(timestamp).toLocaleString() : '';

    const { displayTitle, avatarUrl } = require('../utils/conversations').getConversationDisplayInfo(item, appState as any);

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('ChatThread', { conversationId: item.id, title: displayTitle })}
      >
        <View style={styles.cardHeader}>
          <View style={styles.avatarRow}>
            <Image source={{ uri: avatarUrl }} style={styles.convAvatar} />
            <Text style={styles.cardTitle}>{displayTitle}</Text>
          </View>
          <Text style={styles.cardTime}>{formatted}</Text>
        </View>
        <Text style={styles.cardMessage} numberOfLines={2}>
          {item.lastMessage ?? 'Start the conversation'}
        </Text>
      </TouchableOpacity>
    );
  };

  if (loading && !refreshing) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#0f172a" />
        <Text style={styles.loadingText}>Fetching your conversations...</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={conversations}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      contentContainerStyle={styles.listContent}
      ListHeaderComponent={listHeader}
      ListEmptyComponent={<Text style={styles.empty}>Start a chat to see conversations here.</Text>}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />
  );
};

const styles = StyleSheet.create({
  listContent: {
    padding: 16,
    paddingBottom: 80,
    backgroundColor: '#f7f7fb',
  },
  header: {
    marginBottom: 12,
    gap: 6,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  convAvatar: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#e5e7eb',
  },
  subtitle: {
    color: '#475569',
  },
  primaryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  errorText: {
    color: '#b45309',
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    flex: 1,
  },
  cardTime: {
    color: '#6b7280',
    marginLeft: 8,
    fontSize: 12,
  },
  cardMessage: {
    color: '#111827',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f7f7fb',
  },
  loadingText: {
    marginTop: 10,
    color: '#475569',
    fontWeight: '600',
  },
  separator: {
    height: 12,
  },
  empty: {
    textAlign: 'center',
    color: '#475569',
    marginTop: 40,
    fontWeight: '600',
  },
});

export default ConversationsListScreen;
