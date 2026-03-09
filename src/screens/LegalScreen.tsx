import React from 'react';
import { ScrollView, StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../store/ThemeContext';
import { RootStackParamList } from '../navigation/types';

type Route = RouteProp<RootStackParamList, 'Legal'>;

const LegalScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation();
  const { colors } = useTheme();

  console.log('LegalScreen: Rendering', params.title);
  if (!params.content) {
    console.warn('LegalScreen: Received empty content for', params.title);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{params.title ?? 'Legal Document'}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.legalText, { color: colors.text }]}>
          {params.content || 'This document is currently unavailable. Please check back later or contact support if the issue persists.'}
        </Text>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: { padding: 4, marginRight: 12 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  content: { padding: 20, paddingBottom: 60 },
  legalText: { fontSize: 15, lineHeight: 22 },
});

export default LegalScreen;
