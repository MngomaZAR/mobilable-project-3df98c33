import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, ActionSheetIOS, Platform, Alert } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/types';
import { StackNavigationProp } from '@react-navigation/stack';
import { useAppData } from '../store/AppDataContext';
import { hasSupabase, supabase } from '../config/supabaseClient';
import { Post } from '../types';
import { resolveStorageRef } from '../services/uploadService';
import { BUCKETS } from '../config/environment';
import { HashtagText } from '../components/HashtagText';
import { reportContent } from '../services/reportService';
import { Ionicons } from '@expo/vector-icons';

type Route = RouteProp<RootStackParamList, 'PostDetail'>;

const PostDetailScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const { state, toggleLike, addComment, fetchComments } = useAppData();
  const [comment, setComment] = useState('');
  const [hydratedPost, setHydratedPost] = useState<Post | null>(null);
  const [loadingPost, setLoadingPost] = useState(false);
  const [reportModalVisible, setReportModalVisible] = useState(false);

  const postFromState = useMemo(() => state.posts.find((p) => p.id === params.postId), [params.postId, state.posts]);
  const post = postFromState ?? hydratedPost;
  const comments = useMemo(
    () => state.comments[params.postId] ?? [],
    [params.postId, state.comments]
  );

  // Load comments when screen mounts
  useEffect(() => {
    fetchComments(params.postId);
  }, [params.postId, fetchComments]);

  useEffect(() => {
    if (postFromState || !hasSupabase) return;
    let mounted = true;
    const loadPost = async () => {
      setLoadingPost(true);
      try {
        const { data } = await supabase
          .from('posts')
          .select('id, author_id, caption, image_url, created_at, location, likes_count, comment_count')
          .eq('id', params.postId)
          .maybeSingle();
        if (!mounted || !data) return;

        const currentUserId = state.currentUser?.id;
        let liked = false;
        if (currentUserId) {
          const { data: likeData } = await supabase
            .from('post_likes')
            .select('post_id')
            .eq('user_id', currentUserId)
            .eq('post_id', data.id)
            .maybeSingle();
          liked = !!likeData;
        }

        const resolvedImageUrl = await resolveStorageRef(data.image_url ?? '', BUCKETS.posts);
        setHydratedPost({
          id: data.id,
          author_id: data.author_id,
          caption: data.caption ?? '',
          image_url: resolvedImageUrl,
          created_at: data.created_at ?? new Date().toISOString(),
          location: data.location ?? undefined,
          likes_count: Number(data.likes_count ?? 0),
          liked,
          comment_count: Number(data.comment_count ?? 0),
        });
      } finally {
        if (mounted) setLoadingPost(false);
      }
    };
    loadPost();
    return () => {
      mounted = false;
    };
  }, [params.postId, postFromState]);

  if (!post && loadingPost) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#0f172a" />
        <Text style={[styles.muted, styles.loadingLabel]}>Loading post details…</Text>
      </View>
    );
  }

  if (!post) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>This post is no longer available.</Text>
      </View>
    );
  }

  const submitComment = async () => {
    if (!comment.trim()) return;
    await addComment(post.id, comment);
    setComment('');
  };

  const handleReport = async () => {
    const targetId = post.id;
    const reasons = ['Inappropriate content', 'Spam', 'Harassment', 'Other'];
    const submitReport = async (reason: string) => {
      try {
        await reportContent({ targetType: 'post', targetId, reason });
        Alert.alert('Reported', 'Thank you. Our team will review this.');
      } catch {
        Alert.alert('Error', 'Failed to submit report.');
      }
    };
    
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', ...reasons], cancelButtonIndex: 0, title: 'Report this post' },
        async (index) => {
          if (index === 0) return;
          await submitReport(reasons[index - 1]);
        }
      );
    } else {
      setReportModalVisible(true);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Modal
        transparent
        visible={reportModalVisible}
        animationType="fade"
        onRequestClose={() => setReportModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.reportCard}>
            <Text style={styles.reportTitle}>Report this post</Text>
            <Text style={styles.reportSubtitle}>Choose a reason and we’ll send it to moderation.</Text>
            {['Inappropriate content', 'Spam', 'Harassment', 'Other'].map((reason) => (
              <TouchableOpacity
                key={reason}
                style={styles.reportOption}
                onPress={async () => {
                  setReportModalVisible(false);
                  try {
                    await reportContent({ targetType: 'post', targetId: post.id, reason });
                    Alert.alert('Reported', 'Thank you. Our team will review this.');
                  } catch {
                    Alert.alert('Error', 'Failed to submit report.');
                  }
                }}
              >
                <Text style={styles.reportOptionText}>{reason}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.reportCancel} onPress={() => setReportModalVisible(false)}>
              <Text style={styles.reportCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Image source={{ uri: post.image_url }} style={styles.image} />
      <View style={styles.content}>
        <View style={styles.row}>
          <HashtagText 
            text={post.caption} 
            style={styles.title} 
            hashtagStyle={{ color: '#6366f1' }}
            onHashtagPress={(tag) => {
               navigation.navigate('Root', {
                 screen: 'Home',
                 params: { searchTag: tag.replace(/^#/, '') },
               });
            }}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <TouchableOpacity onPress={() => toggleLike(post.id)}>
              <Text style={styles.like}>{post.liked ? '♥️' : '♡'} {post.likes_count}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleReport}>
              <Ionicons name="flag-outline" size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>
        </View>
        {post.location ? <Text style={styles.meta}>{post.location}</Text> : null}
        <Text style={styles.meta}>{new Date(post.created_at).toLocaleString()}</Text>

        <Text style={styles.sectionTitle}>Comments</Text>
        {comments.length === 0 ? (
          <Text style={styles.muted}>No comments yet.</Text>
        ) : (
          comments.map((item) => (
            <View key={item.id} style={styles.comment}>
              <Text style={styles.commentAuthor}>{item.user_id}</Text>
              <Text style={styles.commentText}>{item.body}</Text>
            </View>
          ))
        )}

        <View style={styles.commentComposer}>
          <TextInput
            placeholder="Add a comment"
            value={comment}
            onChangeText={setComment}
            style={styles.input}
          />
          <TouchableOpacity style={styles.sendButton} onPress={submitComment}>
            <Text style={styles.sendText}>Post</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: 40,
    backgroundColor: '#f7f7fb',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  muted: {
    color: '#6b7280',
  },
  loadingLabel: {
    marginTop: 10,
    fontWeight: '600',
  },
  image: {
    width: '100%',
    height: 320,
  },
  content: {
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    flex: 1,
    marginRight: 10,
  },
  like: {
    fontWeight: '700',
    color: '#0f172a',
  },
  meta: {
    color: '#6b7280',
    marginTop: 4,
  },
  sectionTitle: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  comment: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  commentAuthor: {
    fontWeight: '700',
    color: '#0f172a',
  },
  commentText: {
    color: '#111827',
    marginTop: 4,
  },
  commentComposer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  sendButton: {
    marginLeft: 10,
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sendText: {
    color: '#fff',
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  reportCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    padding: 22,
  },
  reportTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  reportSubtitle: {
    marginTop: 6,
    marginBottom: 16,
    color: '#64748b',
    lineHeight: 20,
  },
  reportOption: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
    backgroundColor: '#f8fafc',
  },
  reportOptionText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  reportCancel: {
    marginTop: 4,
    alignItems: 'center',
    paddingVertical: 10,
  },
  reportCancelText: {
    color: '#64748b',
    fontWeight: '700',
  },
});

export default PostDetailScreen;
