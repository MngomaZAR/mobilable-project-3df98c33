import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import SocialFeed, { FeedPost } from '../components/SocialFeed';
import { RootStackParamList } from '../navigation/types';
import { Post } from '../types';

type Navigation = StackNavigationProp<RootStackParamList, 'PostDetail'>;

const FeedScreen: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const handleViewPost = (item: FeedPost) => {
    const payload: Post = {
      id: item.id,
      userId: item.userId,
      caption: item.title,
      imageUri: item.imageUrl,
      createdAt: item.createdAt,
      likes: item.likes,
      liked: false,
      commentCount: item.commentCount,
      location: item.location,
    };
    navigation.navigate('PostDetail', { postId: item.id, post: payload });
  };

  return (
    <SocialFeed
      onCreatePost={() => navigation.navigate('CreatePost')}
      onViewPost={handleViewPost}
      onViewProfile={(userId) => navigation.navigate('UserProfile', { userId })}
    />
  );
};

export default FeedScreen;
