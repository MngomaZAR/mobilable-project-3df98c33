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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppData } from '../store/AppDataContext';
import { useTheme } from '../store/ThemeContext';
import { StackNavigationProp } from '@react-navigation/stack';
import { hasSupabase } from '../config/supabaseClient';
import { RootStackParamList } from '../navigation/types';
import { PLACEHOLDER_AVATAR } from '../utils/constants';

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
  last_message?: string | null;
  last_message_at?: string | null;
  created_at?: string | null;
  avatar_url?: string;
};

const ConversationsListScreen: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const { state: appState } = useAppData();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConversations = useCallback(async () => {
    setError(null);
    if (!hasSupabase) {
      setConversations(appState.conversations);
      return;
    }

    try {
      const mapped = appState.conversations.map((convo) => ({
        id: convo.id,
        title: convo.title,
        last_message: convo.last_message,
        last_message_at: convo.last_message_at,
        created_at: convo.created_at,
        avatar_url: convo.participant?.avatar_url ?? undefined,
      }));
      setConversations(mapped);
    } catch (err: any) {
      setError('Unable to load conversations.');
    }
  }, [appState.conversations]);

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

  useEffect(() => {
    if (!hasSupabase) setConversations(appState.conversations);
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
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Conversations</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Keep your conversations in one place.</Text>
        </View>
        <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.accent }]} onPress={handleNewChat}>
          <Text style={[styles.primaryButtonText, { color: isDark ? colors.bg : '#fff' }]}>Find photographer</Text>
        </TouchableOpacity>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    ),
    [error, handleNewChat, colors, isDark]
  );



  const renderItem = ({ item }: { item: Conversation }) => {
    const timestamp = item.last_message_at ?? item.created_at;
    const formatted = timestamp ? new Date(timestamp).toLocaleString() : '';

      const displayTitle = item.title !== 'Conversation' ? item.title : 'Chat';
      const avatarUrl = item.avatar_url ?? PLACEHOLDER_AVATAR;

      return (
        <TouchableOpacity
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => navigation.navigate('ChatThread', { conversationId: item.id, title: displayTitle, avatarUrl })}
        >
        <View style={styles.cardHeader}>
          <View style={styles.avatarRow}>
            <Image source={{ uri: avatarUrl }} style={[styles.convAvatar, { backgroundColor: colors.bg }]} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>{displayTitle}</Text>
          </View>
          <Text style={[styles.cardTime, { color: colors.textMuted }]}>{formatted}</Text>
        </View>
        <Text style={[styles.cardMessage, { color: colors.textSecondary }]} numberOfLines={2}>
          {item.last_message ?? 'Start the conversation'}
        </Text>
      </TouchableOpacity>
    );
  };

  if (loading && !refreshing) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Fetching your conversations...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />}
        contentContainerStyle={[styles.listContent, { backgroundColor: colors.bg }]}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={<Text style={[styles.empty, { color: colors.textMuted }]}>Start a chat to see conversations here.</Text>}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  listContent: {
    padding: 16,
    paddingBottom: 80,
  },
  header: {
    marginBottom: 12,
    gap: 6,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
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
  },
  subtitle: {
  },
  primaryButton: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
  },
  primaryButtonText: {
    fontWeight: '700',
  },
  errorText: {
    color: '#b45309',
    fontWeight: '700',
  },
  card: {
    borderRadius: 14,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
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
    flex: 1,
  },
  cardTime: {
    marginLeft: 8,
    fontSize: 12,
  },
  cardMessage: {
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontWeight: '600',
  },
  separator: {
    height: 12,
  },
  empty: {
    textAlign: 'center',
    marginTop: 40,
    fontWeight: '600',
  },
});

export default ConversationsListScreen;
