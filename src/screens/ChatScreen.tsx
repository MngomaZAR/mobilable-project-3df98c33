import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, Image } from 'react-native';
import { AnimatedBubble } from '../components/AnimatedBubble';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useAppData } from '../store/AppDataContext';
import { ChatSkeleton } from '../components/Skeleton';
import { RootStackParamList } from '../navigation/types';

type Route = RouteProp<RootStackParamList, 'ChatThread'>;
type Navigation = StackNavigationProp<RootStackParamList, 'ChatThread'>;


const ChatScreen: React.FC = () => {
  const route = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { state, sendMessage, sendLockedMediaMessage, fetchMessages } = useAppData();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const listRef = useRef<FlatList<any> | null>(null);

  const chatId = route.params.conversationId;
  const messages = useMemo(() => state.messages.filter((m) => m.chatId === chatId), [chatId, state.messages]);
  const latestUnlockBooking = useMemo(() => state.bookings[0] ?? null, [state.bookings]);

  const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=300&q=80';
  const LOCKED_MEDIA_FULL =
    'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?auto=format&fit=crop&w=1200&q=80';
  const LOCKED_MEDIA_PREVIEW =
    'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?auto=format&fit=crop&w=500&q=20';

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



  const handleSend = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await sendMessage(chatId, text);
      setText('');
    } finally {
      setSending(false);
    }
  };

  const handleSendLockedMedia = async () => {
    if (!latestUnlockBooking) {
      Alert.alert('Booking needed', 'Create a booking first so media can unlock after payment.');
      return;
    }
    setSending(true);
    try {
      await sendLockedMediaMessage(chatId, {
        mediaUrl: LOCKED_MEDIA_FULL,
        previewUrl: LOCKED_MEDIA_PREVIEW,
        text: 'Photo delivered (payment-gated)',
        unlockBookingId: latestUnlockBooking.id,
      });
    } catch (err: any) {
      Alert.alert('Unable to send', err?.message ?? 'Could not send locked media.');
    } finally {
      setSending(false);
    }
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
              <Text style={styles.bannerTitle}>Conversations</Text>
              <Text style={styles.bannerText}>Messages stay synced to your account and booking activity.</Text>
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
                    {item.messageType === 'media' ? (
                      <View>
                        <Image
                          source={{ uri: item.unlocked ? item.mediaUrl ?? item.previewUrl ?? PLACEHOLDER_IMAGE : item.previewUrl ?? PLACEHOLDER_IMAGE }}
                          style={styles.mediaImage}
                        />
                        {item.locked && !item.unlocked ? (
                          <View style={styles.lockOverlay}>
                            <Text style={styles.lockText}>Locked until payment clears</Text>
                          </View>
                        ) : null}
                        {item.text ? <Text style={[styles.bubbleText, item.fromUser && styles.bubbleTextLight, styles.mediaCaption]}>{item.text}</Text> : null}
                        {item.locked && !item.unlocked && item.unlockBookingId ? (
                          <TouchableOpacity
                            style={styles.unlockButton}
                            onPress={() => navigation.navigate('Payment', { bookingId: item.unlockBookingId as string })}
                          >
                            <Text style={styles.unlockButtonText}>Pay to unlock</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ) : (
                      <Text style={[styles.bubbleText, item.fromUser && styles.bubbleTextLight]}>{item.text}</Text>
                    )}
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
        <TouchableOpacity
          style={[styles.mediaButton, sending && styles.mediaButtonDisabled]}
          onPress={handleSendLockedMedia}
          disabled={sending}
        >
          <Text style={styles.mediaButtonText}>Locked photo</Text>
        </TouchableOpacity>
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
  mediaImage: {
    width: 210,
    height: 150,
    borderRadius: 10,
    backgroundColor: '#0f172a',
  },
  mediaCaption: {
    marginTop: 6,
  },
  lockOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    borderRadius: 10,
  },
  lockText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
  },
  unlockButton: {
    marginTop: 8,
    borderRadius: 10,
    backgroundColor: '#22c55e',
    paddingVertical: 8,
    alignItems: 'center',
  },
  unlockButtonText: {
    color: '#06280f',
    fontWeight: '800',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  mediaButton: {
    backgroundColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginRight: 8,
  },
  mediaButtonDisabled: {
    opacity: 0.6,
  },
  mediaButtonText: {
    color: '#0f172a',
    fontWeight: '700',
    fontSize: 12,
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
