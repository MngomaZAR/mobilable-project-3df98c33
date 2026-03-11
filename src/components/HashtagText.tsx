import React from 'react';
import { Text, StyleSheet, TextStyle, TouchableOpacity } from 'react-native';

interface HashtagTextProps {
  text: string;
  style?: TextStyle | TextStyle[];
  hashtagStyle?: TextStyle | TextStyle[];
  onHashtagPress?: (hashtag: string) => void;
}

export const HashtagText: React.FC<HashtagTextProps> = ({ 
  text, 
  style, 
  hashtagStyle,
  onHashtagPress 
}) => {
  if (!text) return null;

  // Regex to match #hashtags
  const hashtagRegex = /(#[a-zA-Z0-9_]+)/g;
  const parts = text.split(hashtagRegex);

  return (
    <Text style={style}>
      {parts.map((part, index) => {
        if (part.match(hashtagRegex)) {
          return (
            <Text 
              key={`${index}-${part}`} 
              style={[styles.hashtag, hashtagStyle]}
              onPress={onHashtagPress ? () => onHashtagPress(part) : undefined}
            >
              {part}
            </Text>
          );
        }
        return <Text key={`${index}-${part}`}>{part}</Text>;
      })}
    </Text>
  );
};

const styles = StyleSheet.create({
  hashtag: {
    color: '#3b82f6',
    fontWeight: '600',
  },
});
