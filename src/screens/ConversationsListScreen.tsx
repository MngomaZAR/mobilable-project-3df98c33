import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useAppData } from '../store/AppDataContext';
import { StackNavigationProp } from '@react-navigation/stack';
import { supabase, hasSupabase } from '../config/supabaseClient';
import { uid } from '../utils/id';
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
  const [creating, setCreating] = useState(false);
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
      // Use local conversations from AppDataContext when Supabase is not configured
      setError('Supabase is not configured — messages are local only. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to your .env to enable sync.');
      setConversations(appState.conversations as any);
      return;
    }

    let data: any[] | null = null;
    try {
      const res = await supabase
        .from('conversations')
        .select('id, title, last_message, last_message_at, created_at')
        .order('last_message_at', { ascending: false })
        .order('created_at', { ascending: false });

      data = res.data;
      const fetchError = res.error;

      // fetch participants for these conversations if the table exists
      let participantsMap: Record<string, string[]> = {};
      try {
        const ids = (data ?? []).map((r: any) => r.id).filter(Boolean);
        if (ids.length > 0) {
          const { data: partData } = await supabase
            .from('conversation_participants')
            .select('conversation_id, user_id')
            .in('conversation_id', ids as string[]);
          (partData ?? []).forEach((p: any) => {
            const cid = p.conversation_id as string;
            participantsMap[cid] = participantsMap[cid] ? [...participantsMap[cid], p.user_id] : [p.user_id];
          });
        }
      } catch (e) {
        // table might not exist yet; ignore
      }

      if (fetchError) {
        const raw = (fetchError as any)?.message ?? String(fetchError);
        const lower = String(raw).toLowerCase();
        const message =
          (fetchError as any)?.code === '42P01'
            ? 'Conversations table missing. Apply the latest Supabase migration.'
            : /failed to fetch/i.test(raw) || lower.includes('network') || lower.includes('typeerror')
            ? 'Network error contacting Supabase. Check your EXPO_PUBLIC_SUPABASE_URL and network connectivity.'
            : raw;
        setError(message);
        return;
      }

      const mapped = (data ?? []).map(mapConversation).map((c: Conversation) => ({ ...c, participants: participantsMap[c.id] ?? undefined }));
    // If a conversation has no explicit title and exactly two participants, try to fetch the other participant name for a friendly title
    try {
      const convoWithoutTitleOtherIds: Record<string, string> = {};
      const { data: userData } = await supabase.auth.getUser();
      const currentUserId = userData?.user?.id ?? null;

      (mapped ?? []).forEach((conv: Conversation) => {
        if ((!conv.title || conv.title === 'Conversation') && conv.participants && conv.participants.length === 2 && currentUserId) {
          // other participant id
          const other = conv.participants.find((id) => id !== currentUserId) as any;
          if (other) convoWithoutTitleOtherIds[conv.id] = other;
        }
      });

      const otherIds = Object.values(convoWithoutTitleOtherIds);
      if (otherIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', otherIds);
        const nameMap: Record<string, string> = {};
        (profiles ?? []).forEach((p: any) => {
          nameMap[p.id] = p.full_name ?? 'Creator';
        });
        // apply names
        mapped.forEach((conv: any) => {
          const otherId = convoWithoutTitleOtherIds[conv.id];
          if (otherId && nameMap[otherId]) conv.title = nameMap[otherId];
        });
      }
    } catch (e) {
      // ignore friendly title fallback failures
    }

    setConversations(mapped);
    } catch (err: any) {
      const raw = String(err?.message ?? err);
      const lower = raw.toLowerCase();
      const message = /failed to fetch/i.test(raw) || lower.includes('network') || lower.includes('typeerror')
        ? 'Network error contacting Supabase. Check your EXPO_PUBLIC_SUPABASE_URL and network connectivity.'
        : raw;
      setError(message);
    }
  }, [mapConversation]);

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

  const handleNewChat = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const title = `New chat · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

      if (!hasSupabase) {
        // local-only fallback
        const newConv = { id: uid('conv'), title, lastMessage: 'Say hello 👋', lastMessageAt: new Date().toISOString(), createdAt: new Date().toISOString() };
        setConversations((prev) => [newConv as Conversation, ...prev]);
        navigation.navigate('Root', { screen: 'Chat', params: { conversationId: newConv.id, title: newConv.title } });
        return;
      }

      const { data: userData } = await supabase.auth.getUser();
      const { data, error: insertError } = await supabase
        .from('conversations')
        .insert({
          title,
          created_by: userData?.user?.id ?? null,
          last_message: 'Say hello 👋',
          last_message_at: new Date().toISOString(),
        })
        .select('id, title, last_message, last_message_at, created_at')
        .single();

      if (insertError) throw insertError;

      const mapped = mapConversation(data as ConversationRow);
      setConversations((prev) => [mapped, ...prev]);
      // Open the Chat tab and pass the conversation as params so the Chat screen can hydrate the thread
      navigation.navigate('Root', { screen: 'Chat', params: { conversationId: mapped.id, title: mapped.title } });
    } catch (err: any) {
      setError(err.message ?? 'Unable to start a new chat right now.');
    } finally {
      setCreating(false);
    }
  }, [mapConversation, navigation]);

  const listHeader = useMemo(
    () => (
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Conversations</Text>
          <Text style={styles.subtitle}>Synced from Supabase so you can keep the chat flowing.</Text>
        </View>
        <TouchableOpacity style={styles.primaryButton} onPress={handleNewChat} disabled={creating}>
          <Text style={styles.primaryButtonText}>{creating ? 'Creating...' : 'New Chat'}</Text>
        </TouchableOpacity>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    ),
    [creating, error, handleNewChat]
  );

  const renderItem = ({ item }: { item: Conversation }) => {
    const timestamp = item.lastMessageAt ?? item.createdAt;
    const formatted = timestamp ? new Date(timestamp).toLocaleString() : '';
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('Root', { screen: 'Chat', params: { conversationId: item.id, title: item.title } })}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{item.title}</Text>
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
