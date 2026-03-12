import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { Alert, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, Image } from 'react-native';
import { AnimatedBubble } from '../components/AnimatedBubble';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useAuth } from '../store/AuthContext';
import { useMessaging } from '../store/MessagingContext';
import { useBooking } from '../store/BookingContext';
import { useTheme } from '../store/ThemeContext';
import { ChatSkeleton } from '../components/Skeleton';
import { RootStackParamList } from '../navigation/types';
import { Ionicons } from '@expo/vector-icons';
import { PLACEHOLDER_IMAGE } from '../utils/constants';
import { resolveStorageRef, uploadBlurredPreview } from '../services/uploadService';
import { BUCKETS } from '../config/environment';

type Route = RouteProp<RootStackParamList, 'ChatThread'>;
type Navigation = StackNavigationProp<RootStackParamList, 'ChatThread'>;


const ChatScreen: React.FC = () => {
  const route = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { currentUser } = useAuth();
  const { messages: allMessages, sendMessage, sendLockedMediaMessage, fetchMessages, subscribeToMessages } = useMessaging();
  const { bookings } = useBooking();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);
  const [pendingMedia, setPendingMedia] = useState<{ uri: string; preview: string } | null>(null);
  const [isLockedPending, setIsLockedPending] = useState(true);

  const listRef = useRef<FlatList>(null);

  const chatId = route.params.conversationId;
  const messages = useMemo(() => allMessages[chatId] ?? [], [chatId, allMessages]);
  const latestUnlockBooking = useMemo(() => bookings[0] ?? null, [bookings]);


  const otherAvatar = route.params?.avatarUrl ?? PLACEHOLDER_IMAGE;

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

    if (route.params?.title) {
      navigation.setOptions({ title: route.params.title });
    }

    // Subscribe to realtime messages and store cleanup fn to prevent memory leak
    const unsubscribe = subscribeToMessages?.(chatId);

    return () => {
      mounted = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);



  const handleSend = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await sendMessage(chatId, text);
      setText('');
    } finally {
      setSending(false);
    }
  };

  const handlePickMedia = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.6,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      // Enforce 5MB file size limit
      if ((asset.fileSize ?? 0) > 5 * 1024 * 1024) {
        Alert.alert('Image too large', 'Please choose an image under 5MB.');
        return;
      }
      // Generate a real blurred low-res preview for locked content
      setSending(true);
      try {
        const previewRes = await uploadBlurredPreview(asset.uri);
        setPendingMedia({
          uri: asset.uri,
          preview: previewRes.success ? await resolveStorageRef(previewRes.data, BUCKETS.previews) : asset.uri,
        });
      } finally {
        setSending(false);
      }
      setIsLockedPending(true);
    }
  };

  const confirmSendMedia = async () => {
    if (!pendingMedia) return;
    if (isLockedPending && !latestUnlockBooking) {
      Alert.alert('Booking needed', 'To send a locked photo, you must have an active booking.');
      return;
    }

    setSending(true);
    try {
      await sendLockedMediaMessage(chatId, {
        mediaUrl: pendingMedia.uri,
        previewUrl: pendingMedia.preview,
        text: text.trim() || (isLockedPending ? 'Locked Photo' : 'Shared Photo'),
        unlockBookingId: isLockedPending ? (latestUnlockBooking?.id as any) : undefined,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPendingMedia(null);
      setText('');
    } catch (err: any) {
      Alert.alert('Upload failed', err.message || 'Could not upload image.');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
      {messagesLoading && messages.length === 0 ? (
        <ChatSkeleton />
      ) : !messagesLoading && messages.length === 0 ? (
        <View style={styles.errorContainer}>
          <Ionicons name="chatbubble-outline" size={48} color={colors.textSecondary} />
          <Text style={[styles.errorTitle, { color: colors.text }]}>No messages yet</Text>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>Start the conversation below!</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          onRefresh={() => fetchMessages(chatId)}
          refreshing={messagesLoading}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 20 }]}
          ListHeaderComponent={
            <View style={[styles.banner, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.bannerTitle, { color: colors.text }]}>Conversations</Text>
              <Text style={[styles.bannerText, { color: colors.textSecondary }]}>Messages stay synced to your account and booking activity.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const isMe = item.from_user;
            
            if (item.message_type === 'media') {
              return (
                <View style={[styles.messageRow, isMe ? styles.meRow : styles.otherRow]}>
                  <TouchableOpacity
                    style={styles.mediaBubble}
                    disabled={!item.unlocked}
                    onPress={() => item.unlocked && setLightboxUri(item.media_url || null)}
                  >
                    <Image
                      source={{ uri: item.unlocked ? item.media_url ?? item.preview_url ?? PLACEHOLDER_IMAGE : item.preview_url ?? PLACEHOLDER_IMAGE }}
                      style={styles.mediaImage}
                    />
                    {item.locked && !item.unlocked && (
                      <View style={styles.lockedOverlay}>
                        <Ionicons name="lock-closed" size={32} color="#fff" />
                        <Text style={styles.unlockPrice}>LOCKED</Text>
                        <Text style={styles.unlockHint}>Unlock after payment</Text>
                      </View>
                    )}
                    {item.body ? <Text style={[styles.messageText, isMe ? styles.meText : styles.otherText, styles.mediaCaption]}>{item.body}</Text> : null}
                  </TouchableOpacity>
                </View>
              );
            }

            return (
              <View style={[styles.messageRow, isMe ? styles.meRow : styles.otherRow]}>
                <AnimatedBubble
                  style={[
                    styles.messageBubble,
                    isMe ? styles.meBubble : styles.otherBubble,
                    isMe ? { backgroundColor: colors.accent } : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }
                  ]}
                >
                  {isMe && !isDark && <LinearGradient colors={['#3b82f6', '#2563eb', '#1d4ed8']} style={StyleSheet.absoluteFillObject} />}
                  <Text style={[styles.messageText, isMe ? [styles.meText, { color: isDark ? colors.bg : '#fff' }] : [styles.otherText, { color: colors.text }]]}>
                    {item.body}
                  </Text>
                  <Text style={[styles.timestamp, isMe ? [styles.meTimestamp, { color: 'rgba(255,255,255,0.7)' }] : [styles.otherTimestamp, { color: colors.textMuted }]]}>
                    {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </AnimatedBubble>
              </View>
            );
          }}
        />
      )}

      {lightboxUri && (
        <TouchableOpacity style={styles.lightboxOverlay} activeOpacity={1} onPress={() => setLightboxUri(null)}>
          <Image source={{ uri: lightboxUri }} style={styles.lightboxImage} />
          <TouchableOpacity style={styles.lightboxClose} onPress={() => setLightboxUri(null)}>
            <Ionicons name="close" size={32} color="#fff" />
          </TouchableOpacity>
        </TouchableOpacity>
      )}

      {pendingMedia && (
        <View style={[styles.previewOverlay, { backgroundColor: 'rgba(0,0,0,0.85)' }]}>
          <View style={[styles.previewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.previewTitle, { color: colors.text }]}>Review Attachment</Text>
            <Image source={{ uri: pendingMedia.uri }} style={styles.previewImage} />
            <View style={styles.previewOptions}>
              <TouchableOpacity 
                style={[styles.lockToggle, { backgroundColor: colors.bg }, isLockedPending && [styles.lockToggleActive, { backgroundColor: colors.accent }]]}
                onPress={() => setIsLockedPending(!isLockedPending)}
              >
                <Ionicons name={isLockedPending ? "lock-closed" : "lock-open"} size={20} color={isLockedPending ? "#fff" : colors.text} />
                <Text style={[styles.lockToggleText, { color: colors.text }, isLockedPending && [styles.lockToggleTextActive, { color: "#fff" }]]}>
                  {isLockedPending ? "Locked (Pay to see)" : "Standard Send"}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.previewActions}>
              <TouchableOpacity style={[styles.cancelBtn, { backgroundColor: colors.bg }]} onPress={() => setPendingMedia(null)}>
                <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: colors.accent }]} onPress={confirmSendMedia} disabled={sending}>
                <Text style={[styles.confirmBtnText, { color: isDark ? colors.bg : '#fff' }]}>{sending ? "Sending..." : "Send Now"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <View style={[styles.inputWrapper, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={[styles.inputContainer, { backgroundColor: colors.bg, borderColor: colors.border }]}>
          <TouchableOpacity 
            style={styles.attachButton} 
            onPress={handlePickMedia}
            disabled={sending}
          >
            <Ionicons name="camera" size={28} color={colors.accent} />
          </TouchableOpacity>
          <TextInput
            style={[styles.input, { color: colors.text }]}
            value={text}
            onChangeText={setText}
            placeholder="Type a message..."
            placeholderTextColor={colors.textMuted}
            multiline
          />
          <TouchableOpacity
            onPress={handleSend}
            disabled={sending || !text.trim()}
            style={[styles.sendButton, { backgroundColor: text.trim() ? colors.accent : colors.border }, (!text.trim() || sending) && styles.sendButtonDisabled]}
          >
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 20,
  },
  banner: {
    padding: 16,
    borderRadius: 16,
    marginBottom: 20,
    borderWidth: 1,
  },
  bannerTitle: {
    fontWeight: '800',
    fontSize: 16,
    marginBottom: 4,
  },
  bannerText: {
    fontSize: 13,
    lineHeight: 18,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 4,
    maxWidth: '85%',
  },
  meRow: {
    alignSelf: 'flex-end',
    justifyContent: 'flex-end',
  },
  otherRow: {
    alignSelf: 'flex-start',
    justifyContent: 'flex-start',
  },
  messageBubble: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    overflow: 'hidden',
  },
  meBubble: {
    borderBottomRightRadius: 4,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  otherBubble: {
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 20,
  },
  meText: {
  },
  otherText: {
  },
  timestamp: {
    fontSize: 10,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  meTimestamp: {
  },
  otherTimestamp: {
  },
  mediaBubble: {
    padding: 4,
    borderRadius: 20,
    overflow: 'hidden',
  },
  mediaImage: {
    width: 240,
    height: 180,
    borderRadius: 16,
  },
  mediaCaption: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingBottom: 6,
  },
  lockedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  unlockPrice: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 18,
    marginTop: 10,
    letterSpacing: 2,
  },
  unlockHint: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  inputWrapper: {
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 120,
  },
  attachButton: {
    padding: 4,
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  msgAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 8,
  },
  lightboxOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.95)',
    zIndex: 1000,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxImage: {
    width: '100%',
    height: '80%',
    resizeMode: 'contain',
  },
  lightboxClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    padding: 10,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryButtonText: {
    fontWeight: '700',
    fontSize: 16,
  },
  previewOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2000,
    padding: 20,
  },
  previewCard: {
    borderRadius: 24,
    width: '100%',
    maxWidth: 400,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
    borderWidth: 1,
  },
  previewTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 16,
  },
  previewImage: {
    width: '100%',
    height: 300,
    borderRadius: 16,
    marginBottom: 16,
  },
  previewOptions: {
    width: '100%',
    marginBottom: 20,
  },
  lockToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 12,
    gap: 8,
  },
  lockToggleActive: {
  },
  lockToggleText: {
    fontSize: 14,
    fontWeight: '700',
  },
  lockToggleTextActive: {
  },
  previewActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  cancelBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  confirmBtn: {
    flex: 2,
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  confirmBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
});

export default ChatScreen;
