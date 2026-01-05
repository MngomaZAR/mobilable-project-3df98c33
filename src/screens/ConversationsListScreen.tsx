import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function ConversationsListScreen() {
  return (
    <View style={styles.container}>
      <Text>Conversations List</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
