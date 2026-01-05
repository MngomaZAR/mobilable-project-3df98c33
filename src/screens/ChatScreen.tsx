import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useAppData } from '../store/AppDataContext';
import { RootStackParamList } from '../navigation/types';

type Route = RouteProp<RootStackParamList, 'ChatThread'>;

const ChatScreen: React.FC = () => {
  const route = useRoute<Route>();
  const navigation = useNavigation();
  const { state, sendMessage } = useAppData();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const conversationId = route.params?.conversationId ?? state.conversations[0]?.id ?? 'demo-conversation';
  const messages = useMemo(
    () => state.messages.filter((message) => message.conversationId === conversationId),
    [conversationId, state.messages]
  );

  useEffect(() => {
    if (route.params?.title) {
      navigation.setOptions({ title: route.params.title });
    }
  }, [navigation, route.params?.title]);

  const handleSend = async () => {
    if (!text.trim()) return;
    setSending(true);
    await sendMessage(conversationId, text);
    setText('');
    setSending(false);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}
      >
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>Realtime chat</Text>
            <Text style={styles.bannerText}>
              Connect this screen to Supabase Realtime with a booking_id channel to sync messages across devices.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.fromUser ? styles.bubbleUser : styles.bubblePhotographer]}>
            <Text style={[styles.bubbleText, item.fromUser && styles.bubbleTextLight]}>{item.text}</Text>
            <Text style={[styles.bubbleMeta, item.fromUser && styles.bubbleMetaLight]}>
              {new Date(item.timestamp).toLocaleTimeString()}
            </Text>
          </View>
        )}
      />
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
