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
import { uploadBlurredPreview, uploadImage } from '../services/uploadService';
import { BUCKETS } from '../config/environment';
import { reportContent } from '../services/reportService';
import HowItWorksCard from '../components/HowItWorksCard';

type Route = RouteProp<RootStackParamList, 'ChatThread'>;
type Navigation = StackNavigationProp<RootStackParamList, 'ChatThread'>;


const ChatScreen: React.FC = () => {
  const route = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { currentUser } = useAuth();
  const {
    messages: allMessages, sendMessage, sendLockedMediaMessage,
    fetchMessages, subscribeToMessages, unlockPremiumMessage,
    typingUsers, broadcastTyping, markMessagesRead, reactions,
    addReaction, removeReaction, deleteMessage
  } = useMessaging();
  const { bookings } = useBooking();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesLoadError, setMessagesLoadError] = useState<string | null>(null);
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);
  const [pendingMedia, setPendingMedia] = useState<{ uri: string; preview: string } | null>(null);
  const [isLockedPending, setIsLockedPending] = useState(true);
  const [unlockPriceInput, setUnlockPriceInput] = useState('50');
  
  // Chat UX states
  const [replyTo, setReplyTo] = useState<any>(null);
  const [activeMenuMsg, setActiveMenuMsg] = useState<string | null>(null);

  const listRef = useRef<FlatList>(null);

  const chatId = route.params.conversationId;
  const messages = useMemo(() => allMessages[chatId] ?? [], [chatId, allMessages]);
  const currentTypers = typingUsers[chatId] ?? [];


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
      setMessagesLoadError(null);
      try {
        await Promise.race([
          fetchMessages?.(chatId),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Messages are taking too long to load. Pull to retry.')), 12000)),
        ]);
      } catch (err: any) {
        setMessagesLoadError(err?.message || 'Could not load messages.');
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
  }, [chatId]);



  const handleSend = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await sendMessage(chatId, text, replyTo?.id);
      setText('');
      setReplyTo(null);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (err: any) {
      Alert.alert('Message blocked', err?.message || 'Unable to send this message right now.');
    } finally {
      setSending(false);
    }
  };

  const handleReaction = async (msgId: string, emoji: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await addReaction(chatId, msgId, emoji);
    setActiveMenuMsg(null);
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
          preview: previewRes.success ? previewRes.data : asset.uri,
        });
      } finally {
        setSending(false);
      }
      setIsLockedPending(true);
    }
  };

  const confirmSendMedia = async () => {
    if (!pendingMedia) return;

    const priceNum = Number(unlockPriceInput);
    if (isLockedPending && (isNaN(priceNum) || priceNum <= 0)) {
      Alert.alert('Invalid Price', 'Please enter a valid price to lock this photo.');
      return;
    }

    setSending(true);
    try {
      // Upload original media first so receivers don't get local file:// URIs.
      const uploadedMediaRef = await uploadImage(pendingMedia.uri, BUCKETS.previews, { returnStorageRef: true });
      await sendLockedMediaMessage(chatId, {
        mediaUrl: uploadedMediaRef,
        previewUrl: pendingMedia.preview,
        text: text.trim() || (isLockedPending ? 'Locked Photo' : 'Shared Photo'),
        unlockPrice: isLockedPending ? priceNum : undefined,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPendingMedia(null);
      setText('');
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
      setText('');
    } catch (err: any) {
      Alert.alert('Upload failed', err.message || 'Could not upload image.');
    } finally {
      setSending(false);
    }
  };

  const handleReportConversation = () => {
    const submit = async (reason: string) => {
      try {
        await reportContent({
          targetType: 'message',
          targetId: chatId,
          reason,
          details: `Conversation report from chat thread ${chatId}`,
        });
        Alert.alert('Report submitted', 'Our moderation team will review this conversation.');
      } catch (err: any) {
        Alert.alert('Report failed', err?.message || 'Unable to submit this report right now.');
      }
    };

    Alert.alert(
      'Report conversation',
      'Select the reason so moderation can triage this quickly.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Harassment / abuse', style: 'destructive', onPress: () => submit('Harassment or abuse in conversation') },
        { text: 'Spam', onPress: () => submit('Spam or repeated unsolicited messages') },
        { text: 'Suspicious payment request', onPress: () => submit('Suspicious payment or off-platform request') },
      ]
    );
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
      ) : !messagesLoading && messagesLoadError ? (
        <View style={styles.errorContainer}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.textSecondary} />
          <Text style={[styles.errorTitle, { color: colors.text }]}>Connection issue</Text>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>{messagesLoadError}</Text>
        </View>
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
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          onLayout={() => listRef.current?.scrollToEnd({ animated: true })}
          contentContainerStyle={[styles.listContent, { paddingBottom: currentTypers.length > 0 ? 40 : 20 }]}
          ListHeaderComponent={
            <View style={[styles.banner, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.bannerTitle, { color: colors.text }]}>Conversations</Text>
              <Text style={[styles.bannerText, { color: colors.textSecondary }]}>Messages stay synced to your account and booking activity.</Text>
              <View style={styles.bannerActions}>
                <TouchableOpacity style={[styles.reportBtn, { borderColor: colors.border }]} onPress={handleReportConversation}>
                  <Ionicons name="flag-outline" size={14} color={colors.text} />
                  <Text style={[styles.reportBtnText, { color: colors.text }]}>Report chat</Text>
                </TouchableOpacity>
              </View>
              <HowItWorksCard
                title="How Safe Messaging Works"
                persistKey={`chat-how-${chatId}`}
                items={[
                  'Unknown contacts can send only one intro message until you reply or book together.',
                  'Report chat creates a moderation case with SLA tracking and audit history.',
                  'Blocked or policy-violating users can lose messaging access after review.',
                ]}
              />
            </View>
          }
          renderItem={({ item }) => {
            const isMe = item.from_user;
            
            const msgReactions = reactions[item.id] ?? [];
            const showMenu = activeMenuMsg === item.id;

            const MessageContent = () => (
              <View style={[styles.messageRow, isMe ? styles.meRow : styles.otherRow, { zIndex: showMenu ? 10 : 1 }]}>
                <View style={[isMe ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' }]}>
                  {item.reply_preview && (
                    <View style={styles.inlineReplyPreview}>
                      <Ionicons name="arrow-undo" size={12} color={colors.textSecondary} />
                      <Text style={[styles.inlineReplyText, { color: colors.textSecondary }]} numberOfLines={1}>
                        {item.reply_preview}
                      </Text>
                    </View>
                  )}
                  {item.message_type === 'media' ? (
                    <TouchableOpacity
                      style={styles.mediaBubble}
                      activeOpacity={0.8}
                      onLongPress={() => { Haptics.selectionAsync(); setActiveMenuMsg(item.id); }}
                      onPress={() => {
                        if (item.unlocked) {
                          setLightboxUri(item.media_url || null);
                        } else if (!isMe) {
                          if (item.unlock_price) {
                            Alert.alert('Unlock Message', `Would you like to unlock this message for R${item.unlock_price}?`, [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Unlock', onPress: async () => {
                                  try {
                                    await unlockPremiumMessage(chatId, item.id);
                                  } catch (err: any) {
                                    Alert.alert('Unlock failed', err.message);
                                  }
                              }},
                            ]);
                          } else {
                            Alert.alert('Locked', 'This message needs to be unlocked by an active booking.');
                          }
                        }
                      }}
                    >
                      <Image
                        source={{ uri: item.unlocked ? item.media_url ?? item.preview_url ?? PLACEHOLDER_IMAGE : item.preview_url ?? PLACEHOLDER_IMAGE }}
                        style={styles.mediaImage}
                      />
                      {item.locked && !item.unlocked && (
                        <View style={[styles.lockedOverlay, { padding: 10 }]}>
                          <Ionicons name="lock-closed" size={32} color="#fff" />
                          <Text style={styles.unlockPrice}>{item.unlock_price ? `R${item.unlock_price}` : 'LOCKED'}</Text>
                          <Text style={styles.unlockHint}>{item.unlock_price ? 'Tap here to unlock' : 'Unlock after payment'}</Text>
                        </View>
                      )}
                      {item.body ? <Text style={[styles.messageText, isMe ? styles.meText : styles.otherText, styles.mediaCaption]}>{item.body}</Text> : null}
                    </TouchableOpacity>
                  ) : (
                    <AnimatedBubble
                      style={[
                        styles.messageBubble,
                        isMe ? styles.meBubble : styles.otherBubble,
                        isMe ? { backgroundColor: colors.accent } : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }
                      ]}
                      onLongPress={() => { Haptics.selectionAsync(); setActiveMenuMsg(item.id); }}
                    >
                      {isMe && !isDark && <LinearGradient colors={['#3b82f6', '#2563eb', '#1d4ed8']} style={StyleSheet.absoluteFillObject} />}
                      <Text style={[styles.messageText, isMe ? [styles.meText, { color: isDark ? colors.bg : '#fff' }] : [styles.otherText, { color: colors.text }]]}>
                        {item.body}
                      </Text>
                      <View style={styles.bubbleFooter}>
                        <Text style={[styles.timestamp, isMe ? [styles.meTimestamp, { color: 'rgba(255,255,255,0.7)' }] : [styles.otherTimestamp, { color: colors.textMuted }]]}>
                          {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                        {isMe && (
                          <Ionicons 
                            name={item.read_at ? "checkmark-done" : "checkmark"} 
                            size={14} 
                            color={item.read_at ? "#34d399" : "rgba(255,255,255,0.6)"} 
                            style={{ marginLeft: 4 }}
                          />
                        )}
                      </View>
                    </AnimatedBubble>
                  )}
                  
                  {/* Emoji Reactions Pill */}
                  {msgReactions.length > 0 && (
                    <View style={[styles.reactionPillContainer, isMe ? { right: 8 } : { left: 8 }]}>
                      {msgReactions.map(r => (
                        <TouchableOpacity 
                          key={r.emoji} 
                          style={[styles.reactionPill, r.myReaction && { borderColor: colors.accent, borderWidth: 1 }]}
                          onPress={() => r.myReaction ? removeReaction(chatId, item.id, r.emoji) : addReaction(chatId, item.id, r.emoji)}
                        >
                          <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                          {r.count > 1 && <Text style={styles.reactionCount}>{r.count}</Text>}
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            );

            return (
              <View style={styles.messageRowWrapper}>
                {showMenu && (
                  <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setActiveMenuMsg(null)} activeOpacity={1} />
                )}
                <MessageContent />
                {showMenu && (
                  <View style={[styles.contextMenu, isMe ? { right: 16 } : { left: 16 }]}>
                    <View style={styles.reactionRow}>
                      {['❤️','😂','😮','😢','🔥','💯'].map(emoji => (
                        <TouchableOpacity key={emoji} onPress={() => handleReaction(item.id, emoji)} style={styles.reactionBtn}>
                          <Text style={{ fontSize: 24 }}>{emoji}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={styles.menuActions}>
                      <TouchableOpacity 
                        style={styles.menuItem} 
                        onPress={() => { setReplyTo(item); setActiveMenuMsg(null); }}
                      >
                        <Ionicons name="arrow-undo" size={18} color={colors.text} />
                        <Text style={[styles.menuText, { color: colors.text }]}>Reply</Text>
                      </TouchableOpacity>
                      {isMe && (
                        <TouchableOpacity 
                          style={styles.menuItem} 
                          onPress={() => { deleteMessage(chatId, item.id); setActiveMenuMsg(null); }}
                        >
                          <Ionicons name="trash" size={18} color="#ef4444" />
                          <Text style={[styles.menuText, { color: '#ef4444' }]}>Delete</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                )}
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
              {isLockedPending && (
                <View style={[styles.inputContainer, { marginTop: 12, backgroundColor: colors.bg, borderColor: colors.border }]}>
                  <Text style={{ color: colors.textSecondary, marginLeft: 12, marginRight: 4 }}>Price (ZAR): R</Text>
                  <TextInput
                    style={[styles.input, { color: colors.text, maxHeight: 40, paddingVertical: 8 }]}
                    keyboardType="numeric"
                    placeholder="e.g. 50"
                    placeholderTextColor={colors.textMuted}
                    value={unlockPriceInput}
                    onChangeText={setUnlockPriceInput}
                  />
                </View>
              )}
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

      {currentTypers.length > 0 && (
        <View style={styles.typingContainer}>
          <Text style={[styles.typingText, { color: colors.textSecondary }]}>
            {currentTypers.join(', ')} {currentTypers.length === 1 ? 'is' : 'are'} typing...
          </Text>
        </View>
      )}

      <View style={[styles.inputWrapper, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
        {replyTo && (
          <View style={[styles.replyBanner, { backgroundColor: colors.bg, borderLeftColor: colors.accent }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.replyBannerTitle, { color: colors.accent }]}>Replying to {replyTo.from_user ? 'yourself' : 'them'}</Text>
              <Text style={[styles.replyBannerText, { color: colors.text }]} numberOfLines={1}>{replyTo.body || 'Media message'}</Text>
            </View>
            <TouchableOpacity onPress={() => setReplyTo(null)}>
              <Ionicons name="close-circle" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        )}
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
            onChangeText={(v) => { setText(v); broadcastTyping(chatId); }}
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
  bannerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10,
    marginBottom: 8,
  },
  reportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  reportBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  messageRowWrapper: {
    marginBottom: 4,
  },
  messageRow: {
    flexDirection: 'row',
  },
  meRow: {
    alignSelf: 'flex-end',
    justifyContent: 'flex-end',
    paddingLeft: 40,
  },
  otherRow: {
    alignSelf: 'flex-start',
    justifyContent: 'flex-start',
    paddingRight: 40,
  },
  messageBubble: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    overflow: 'hidden',
    minWidth: 80,
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
  bubbleFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 4,
  },
  timestamp: {
    fontSize: 10,
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
  typingContainer: {
    position: 'absolute',
    bottom: 90,
    left: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  typingText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  reactionPillContainer: {
    flexDirection: 'row',
    position: 'absolute',
    bottom: -15,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    zIndex: 5,
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  reactionEmoji: {
    fontSize: 14,
  },
  reactionCount: {
    fontSize: 10,
    fontWeight: '800',
    marginLeft: 2,
    color: '#475569',
  },
  contextMenu: {
    position: 'absolute',
    bottom: -80,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 8,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
    zIndex: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
  },
  reactionRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 8,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#cbd5e1',
  },
  reactionBtn: {
    padding: 2,
  },
  menuActions: {
    paddingTop: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    gap: 12,
  },
  menuText: {
    fontSize: 15,
    fontWeight: '600',
  },
  inlineReplyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    opacity: 0.7,
    backgroundColor: 'rgba(0,0,0,0.05)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    maxWidth: '100%',
  },
  inlineReplyText: {
    fontSize: 11,
    marginLeft: 4,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 8,
    borderRadius: 8,
    borderLeftWidth: 4,
  },
  replyBannerTitle: {
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 2,
  },
  replyBannerText: {
    fontSize: 13,
  },
});

export default ChatScreen;
