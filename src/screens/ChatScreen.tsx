import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, Image } from 'react-native';
import { AnimatedBubble } from '../components/AnimatedBubble';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useAppData } from '../store/AppDataContext';
import { ChatSkeleton } from '../components/Skeleton';
import { hasSupabase } from '../config/supabaseClient';
import { RootStackParamList, TabParamList } from '../navigation/types';

type Route = RouteProp<TabParamList, 'Chat'> | RouteProp<RootStackParamList, 'ChatThread'>;


const ChatScreen: React.FC = () => {
  const route = useRoute<Route>();
  const navigation = useNavigation();
<<<<<<< HEAD
  const { state, sendMessage, fetchMessagesForChat } = useAppData();
=======
  const { state, sendMessage, fetchMessages } = useAppData();
>>>>>>> 080ba05 (chore: save local changes)
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);

<<<<<<< HEAD
  const conversationId = route.params?.conversationId ?? state.conversations?.[0]?.id ?? 'demo-conversation';
  const messages = useMemo(
    () => state.messages.filter((m) => m.chatId === conversationId),
    [conversationId, state.messages]
=======
  const listRef = useRef<FlatList<any> | null>(null);

  const chatId = route.params?.conversationId ?? state.messages[0]?.chatId ?? 'demo-conversation';
  const messages = useMemo(
    () => state.messages.filter((message) => message.chatId === chatId),
    [chatId, state.messages]
>>>>>>> 080ba05 (chore: save local changes)
  );

  const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=300&q=80';

  useEffect(() => {
    if (!chatId) return;
    let mounted = true;
    const load = async () => {
      setMessagesLoading(true);
      try {
        await fetchMessages?.(chatId);
      } finally {
        if (mounted) setMessagesLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  useEffect(() => {
    if (listRef.current) {
      try {
        listRef.current.scrollToOffset({ offset: 999999, animated: true });
      } catch (e) {
        // ignore scroll failures
      }
    }
  }, [messages.length]);

  useEffect(() => {
    if (route.params?.title) {
      navigation.setOptions({ title: route.params.title });
    }
  }, [navigation, route.params?.title]);

  useEffect(() => {
    if (conversationId && conversationId !== 'demo-conversation') {
      fetchMessagesForChat(conversationId);
    }
  }, [conversationId, fetchMessagesForChat]);

  const handleSend = async () => {
    if (!text.trim()) return;
    setSending(true);
<<<<<<< HEAD
    try {
      await sendMessage(conversationId, text);
      setText('');
    } finally {
      setSending(false);
    }
=======
    await sendMessage(chatId, text);
    setText('');
    setSending(false);
>>>>>>> 080ba05 (chore: save local changes)
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}
      >
      {messagesLoading && messages.length === 0 ? (
        <ChatSkeleton />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.banner}>
              <Text style={styles.bannerTitle}>Realtime chat</Text>
              <Text style={styles.bannerText}>
                {hasSupabase
                  ? 'Connect this screen to Supabase Realtime with a booking_id channel to sync messages across devices.'
                  : 'Supabase is not configured — messages are local only. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to your .env to enable realtime sync.'}
              </Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const prev = messages[index - 1];
            const sameSenderAsPrev = prev ? prev.fromUser === item.fromUser : false;
            return (
              <AnimatedBubble style={{ marginBottom: sameSenderAsPrev ? 4 : 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                  {!item.fromUser ? (
                    sameSenderAsPrev ? <View style={{ width: 34 }} /> : <Image source={{ uri: PLACEHOLDER_IMAGE }} style={styles.msgAvatar} />
                  ) : null}
                  <View style={[styles.bubble, item.fromUser ? styles.bubbleUser : styles.bubblePhotographer, { maxWidth: '78%' }]}>
                    <Text style={[styles.bubbleText, item.fromUser && styles.bubbleTextLight]}>{item.text}</Text>
                    <Text style={[styles.bubbleMeta, item.fromUser && styles.bubbleMetaLight]}>
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </Text>
                  </View>
                  {item.fromUser ? (
                    sameSenderAsPrev ? <View style={{ width: 34 }} /> : <Image source={{ uri: PLACEHOLDER_IMAGE }} style={styles.msgAvatar} />
                  ) : null}
                </View>
              </AnimatedBubble>
            );
          }}
        />
      )}
      <View style={styles.composer}>
        <TextInput
          placeholder="Send a message"
          value={text}
          onChangeText={setText}
          style={styles.input}
        />
        <TouchableOpacity style={styles.sendButton} onPress={handleSend} disabled={sending}>
          <Text style={styles.sendText}>{sending ? '...' : 'Send'}</Text>
        </TouchableOpacity>
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f7f7fb',
  },
  container: {
    flex: 1,
    backgroundColor: '#f7f7fb',
  },
  listContent: {
    padding: 16,
    paddingBottom: 90,
  },
  banner: {
    backgroundColor: '#e0f2fe',
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  bannerTitle: {
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  bannerText: {
    color: '#0f172a',
  },
  bubble: {
    maxWidth: '85%',
    padding: 12,
    borderRadius: 14,
    marginBottom: 10,
  },
  msgAvatar: {
    width: 34,
    height: 34,
    borderRadius: 8,
    marginRight: 8,
    marginLeft: 8,
    backgroundColor: '#e5e7eb',
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: '#0f172a',
  },
  bubblePhotographer: {
    alignSelf: 'flex-start',
    backgroundColor: '#e5e7eb',
  },
  bubbleText: {
    color: '#0f172a',
  },
  bubbleTextLight: {
    color: '#fff',
  },
  bubbleMeta: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 4,
  },
  bubbleMetaLight: {
    color: '#e5e7eb',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginRight: 10,
  },
  sendButton: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sendText: {
    color: '#fff',
    fontWeight: '700',
  },
});

export default ChatScreen;
