import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, ActionSheetIOS, Platform, Alert } from 'react-native';
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
    
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', ...reasons], cancelButtonIndex: 0, title: 'Report this post' },
        async (index) => {
          if (index === 0) return;
          try {
            await reportContent({ targetType: 'post', targetId, reason: reasons[index - 1] });
            Alert.alert('Reported', 'Thank you. Our team will review this.');
          } catch (e) {
            Alert.alert('Error', 'Failed to submit report.');
          }
        }
      );
    } else if (Platform.OS === 'web') {
      const reason = window.prompt(`Why are you reporting this post?\nOptions: ${reasons.join(', ')}`);
      if (reason && reasons.some(r => r.toLowerCase() === reason.toLowerCase())) {
        await reportContent({ targetType: 'post', targetId, reason });
        window.alert('Reported. Thank you. Our team will review this.');
      } else if (reason) {
        await reportContent({ targetType: 'post', targetId, reason: 'Other' });
        window.alert('Reported. Thank you. Our team will review this.');
      }
    } else {
      Alert.alert('Report Post', 'Why are you reporting this?',
        [
          ...reasons.map((reason) => ({
            text: reason,
            onPress: async () => {
              try {
                await reportContent({ targetType: 'post', targetId, reason });
                Alert.alert('Reported', 'Thank you. Our team will review this.');
              } catch (e) {
                Alert.alert('Error', 'Failed to submit report.');
              }
            }
          })),
          { text: 'Cancel', style: 'cancel' as const }
        ]
      );
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Image source={{ uri: post.image_url }} style={styles.image} />
      <View style={styles.content}>
        <View style={styles.row}>
          <HashtagText 
            text={post.caption} 
            style={styles.title} 
            hashtagStyle={{ color: '#6366f1' }}
            onHashtagPress={(tag) => {
               // Placeholder for TagSearch
               alert(`Searching for ${tag}`);
               // navigation.navigate('Search', { query: tag });
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
});

export default PostDetailScreen;
