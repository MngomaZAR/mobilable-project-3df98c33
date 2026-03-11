import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import SocialFeed from '../components/SocialFeed';
import { RootStackParamList } from '../navigation/types';
import { Post } from '../types';

type Navigation = StackNavigationProp<RootStackParamList, 'PostDetail'>;

const FeedScreen: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const handleViewPost = (item: Post) => {
    navigation.navigate('PostDetail', { postId: item.id });
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
