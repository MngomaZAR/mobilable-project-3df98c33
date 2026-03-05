import React, { useEffect, useMemo, useState } from 'react';
import { Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/types';
import { StackNavigationProp } from '@react-navigation/stack';
import { useAppData } from '../store/AppDataContext';

type Route = RouteProp<RootStackParamList, 'PostDetail'>;
type Navigation = StackNavigationProp<RootStackParamList, 'PostDetail'>;

const PostDetailScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { state, toggleLike, addComment, fetchCommentsForPost } = useAppData();
  const [comment, setComment] = useState('');
  const [zoomOpen, setZoomOpen] = useState(false);

  const post = useMemo(
    () => params.post ?? state.posts.find((p) => p.id === params.postId),
    [params.post, params.postId, state.posts]
  );
  const comments = useMemo(
    () => state.comments.filter((c) => c.postId === params.postId),
    [params.postId, state.comments]
  );

  if (!post) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>This post is no longer available.</Text>
      </View>
    );
  }

  useEffect(() => {
    fetchCommentsForPost(params.postId);
  }, [fetchCommentsForPost, params.postId]);

  const resolvedImage =
    (post as any).imageUri ?? (post as any).imageUrl ?? (post as any).image_url ?? '';

  const submitComment = async () => {
    if (!comment.trim()) return;
    await addComment(post.id, comment);
    setComment('');
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.container}>
      <TouchableOpacity activeOpacity={0.9} onPress={() => setZoomOpen(true)}>
        <Image source={{ uri: resolvedImage }} style={styles.image} />
      </TouchableOpacity>
      <View style={styles.content}>
        <View style={styles.row}>
          <Text style={styles.title}>{post.caption}</Text>
          <TouchableOpacity onPress={() => toggleLike(post.id)}>
            <Text style={styles.like}>{post.liked ? '♥️' : '♡'} {post.likes}</Text>
          </TouchableOpacity>
        </View>
        {post.location ? <Text style={styles.meta}>{post.location}</Text> : null}
        <Text style={styles.meta}>{new Date(post.createdAt).toLocaleString()}</Text>

        <Text style={styles.sectionTitle}>Comments</Text>
        {comments.length === 0 ? (
          <Text style={styles.muted}>No comments yet.</Text>
        ) : (
          comments.map((item) => (
            <View key={item.id} style={styles.comment}>
              <Text style={styles.commentAuthor}>{item.userId}</Text>
              <Text style={styles.commentText}>{item.text}</Text>
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
        <TouchableOpacity
          style={styles.reportButton}
          onPress={() =>
            navigation.navigate('Report', {
              targetType: 'post',
              targetId: post.id,
              title: post.caption,
            })
          }
        >
          <Text style={styles.reportText}>Report post</Text>
        </TouchableOpacity>
      </View>
      </ScrollView>
      <Modal visible={zoomOpen} animationType="fade" transparent={false}>
        <View style={styles.zoomContainer}>
          <ScrollView
            contentContainerStyle={styles.zoomScrollContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
          >
            <Image source={{ uri: resolvedImage }} style={styles.zoomImage} resizeMode="contain" />
          </ScrollView>
          <TouchableOpacity style={styles.zoomClose} onPress={() => setZoomOpen(false)}>
            <Text style={styles.zoomCloseText}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
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
  image: {
    width: '100%',
    height: 320,
  },
  zoomContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  zoomScrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomImage: {
    width: '100%',
    height: '100%',
  },
  zoomClose: {
    position: 'absolute',
    top: 48,
    right: 20,
    backgroundColor: '#111827cc',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  zoomCloseText: {
    color: '#fff',
    fontWeight: '700',
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
  reportButton: {
    marginTop: 14,
    backgroundColor: '#fee2e2',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  reportText: {
    color: '#991b1b',
    fontWeight: '700',
  },
});

export default PostDetailScreen;
