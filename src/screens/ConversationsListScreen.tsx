import React, { useCallback, useMemo, useEffect, useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../store/ThemeContext';
import { useMessaging } from '../store/MessagingContext';
import { useAppData } from '../store/AppDataContext';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { PLACEHOLDER_AVATAR } from '../utils/constants';
import { getConversationDisplayInfo } from '../utils/conversations';
import { NewMessageModal } from '../components/NewMessageModal';

type Navigation = StackNavigationProp<RootStackParamList, 'Root'>;

const messageDateFormatter = new Intl.DateTimeFormat('en-ZA', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

const ConversationsListScreen: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { conversations, loading, fetchConversations, startConversationWithUser } = useMessaging();
  const { state, currentUser } = useAppData();
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Load on focus so new conversations appear when returning from chat
  useFocusEffect(
    useCallback(() => {
      fetchConversations().catch((err: any) => {
        setInlineError(err?.message || 'Unable to load conversations right now.');
      });
    }, [fetchConversations])
  );

  const handleRefresh = useCallback(() => {
    setInlineError(null);
    fetchConversations().catch((err: any) => {
      setInlineError(err?.message || 'Unable to load conversations right now.');
    });
  }, [fetchConversations]);

  useEffect(() => {
    if (!inlineError) {
      setRetryCount(0);
      return;
    }
    if (retryCount >= 2) return;
    const timer = setTimeout(() => {
      setRetryCount((count) => count + 1);
      handleRefresh();
    }, 4000);
    return () => clearTimeout(timer);
  }, [handleRefresh, inlineError, retryCount]);

  const listHeader = useMemo(
    () => (
      <View style={[styles.header, { paddingTop: Math.max(insets.top + 12, 28) }]}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Conversations</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Keep your conversations in one place.
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: colors.accent }]}
          onPress={() => setShowNewMessage(true)}
        >
          <Ionicons name="create-outline" size={18} color={isDark ? colors.bg : '#fff'} />
          <Text style={[styles.primaryButtonText, { color: isDark ? colors.bg : '#fff' }]}>
            New Chat
          </Text>
        </TouchableOpacity>
      </View>
    ),
    [colors, isDark, insets.top]
  );

  const renderItem = ({ item }: { item: typeof conversations[0] }) => {
    const timestamp = item.last_message_at ?? item.created_at;
    const formatted = timestamp
      ? messageDateFormatter.format(new Date(timestamp)).replace(',', ', ')
      : '';
    const display = getConversationDisplayInfo(item as any, state as any);
    const displayTitle = display.displayTitle && display.displayTitle !== 'Conversation' ? display.displayTitle : 'Chat';
    const avatarUrl = display.avatarUrl || PLACEHOLDER_AVATAR;
    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() =>
          navigation.navigate('ChatThread', {
            conversationId: item.id,
            title: displayTitle,
            avatarUrl,
          })
        }
      >
        <View style={styles.cardHeader}>
          <View style={styles.avatarRow}>
            <Image
              source={{ uri: avatarUrl }}
              style={[styles.convAvatar, { backgroundColor: colors.bg }]}
            />
            <Text
              style={[styles.cardTitle, { color: colors.text }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {displayTitle}
            </Text>
          </View>
          <Text style={[styles.cardTime, { color: colors.textMuted }]}>{formatted}</Text>
        </View>
        <Text style={[styles.cardMessage, { color: colors.textSecondary }]} numberOfLines={2}>
          {item.last_message || 'Start the conversation'}
        </Text>
      </TouchableOpacity>
    );
  };

  if (loading && conversations.length === 0) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          Fetching your conversations...
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {inlineError ? (
        <View style={[styles.inlineError, { backgroundColor: isDark ? '#27121b' : '#fde8e8', borderColor: isDark ? '#5f2638' : '#f5b7b7' }]}>
          <Ionicons name="alert-circle" size={16} color={isDark ? '#fda4af' : '#b91c1c'} />
          <Text style={[styles.inlineErrorText, { color: isDark ? '#fecdd3' : '#7f1d1d' }]}>
            {inlineError}
          </Text>
          <TouchableOpacity style={styles.inlineRetry} onPress={handleRefresh}>
            <Text style={[styles.inlineRetryText, { color: isDark ? '#fecdd3' : '#7f1d1d' }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <FlatList
        data={conversations}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
        contentContainerStyle={[styles.listContent, { backgroundColor: colors.bg }]}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.textMuted }]}>
            No conversations yet. Tap "New Chat" to message a photographer or model.
          </Text>
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      <NewMessageModal
        visible={showNewMessage}
        onClose={() => setShowNewMessage(false)}
        profiles={state.profiles ?? []}
        currentUserId={currentUser?.id}
        onSelectUser={async (user) => {
          try {
            const convo = await startConversationWithUser(user.id, user.full_name ?? 'User');
            setShowNewMessage(false);
            navigation.navigate('ChatThread', { conversationId: convo.id, title: convo.title ?? 'Chat' });
          } catch {
            setShowNewMessage(false);
          }
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  listContent: { padding: 16, paddingBottom: 120 },
  header: { marginBottom: 14, gap: 8 },
  title: { fontSize: 54, fontWeight: '900', lineHeight: 58 },
  subtitle: { fontSize: 16, lineHeight: 22 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  convAvatar: { width: 46, height: 46, borderRadius: 12 },
  primaryButton: {
    alignSelf: 'flex-start',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 12,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  primaryButtonText: { fontWeight: '700', fontSize: 14 },
  card: {
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
    minHeight: 112,
    justifyContent: 'center',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  cardTitle: { fontSize: 18, fontWeight: '800', flexShrink: 1, minWidth: 0 },
  cardTime: { marginLeft: 8, fontSize: 12, flexShrink: 0, marginTop: 3 },
  cardMessage: { fontSize: 15, lineHeight: 21 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 10, fontWeight: '600' },
  separator: { height: 12 },
  empty: { textAlign: 'center', marginTop: 40, fontWeight: '600' },
  inlineError: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inlineErrorText: { flex: 1, fontSize: 12, fontWeight: '600' },
  inlineRetry: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  inlineRetryText: { fontWeight: '700', fontSize: 12 },
});

export default ConversationsListScreen;
