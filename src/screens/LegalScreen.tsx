import React, { useState } from 'react';
import {
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
  Share, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList } from '../navigation/types';
import { LEGAL_CONTENT } from '../constants/LegalContent';

type Route = RouteProp<RootStackParamList, 'Legal'>;

type LegalDoc = {
  key: keyof typeof LEGAL_CONTENT;
  title: string;
  icon: string;
  color: string;
};

const LEGAL_DOCS: LegalDoc[] = [
  { key: 'TERMS_OF_SERVICE', title: 'Terms of Service', icon: 'document-text', color: '#3b82f6' },
  { key: 'PRIVACY_POLICY', title: 'Privacy Policy', icon: 'shield-checkmark', color: '#10b981' },
  { key: 'CREATOR_POLICY', title: 'Creator Policy', icon: 'star', color: '#8b5cf6' },
  { key: 'MODEL_RELEASE', title: 'Model Release', icon: 'camera', color: '#ec4899' },
  { key: 'COMMUNITY_GUIDELINES', title: 'Community Guidelines', icon: 'people', color: '#f59e0b' },
  { key: 'COOKIE_POLICY', title: 'Cookie Policy', icon: 'settings', color: '#06b6d4' },
];

// Simple markdown-to-styled renderer
const renderMarkdown = (text: string): React.ReactNode[] => {
  return text.split('\n').map((line, i) => {
    if (line.startsWith('# ')) {
      return <Text key={i} style={mdStyles.h1}>{line.slice(2)}</Text>;
    }
    if (line.startsWith('## ')) {
      return <Text key={i} style={mdStyles.h2}>{line.slice(3)}</Text>;
    }
    if (line.startsWith('### ')) {
      return <Text key={i} style={mdStyles.h3}>{line.slice(4)}</Text>;
    }
    if (line.startsWith('---')) {
      return <View key={i} style={mdStyles.divider} />;
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      return (
        <View key={i} style={mdStyles.bulletRow}>
          <Text style={mdStyles.bulletDot}>•</Text>
          <Text style={mdStyles.bulletText}>{line.slice(2)}</Text>
        </View>
      );
    }
    if (line.match(/^\d+\.\d*/)) {
      return <Text key={i} style={mdStyles.numbered}>{line}</Text>;
    }
    if (line.startsWith('**') && line.endsWith('**')) {
      return <Text key={i} style={mdStyles.bold}>{line.slice(2, -2)}</Text>;
    }
    if (line.startsWith('|')) {
      return <Text key={i} style={mdStyles.tableRow}>{line}</Text>;
    }
    if (line.trim() === '') {
      return <View key={i} style={{ height: 8 }} />;
    }
    // Inline bold
    const parts = line.split(/\*\*(.*?)\*\*/g);
    if (parts.length > 1) {
      return (
        <Text key={i} style={mdStyles.body}>
          {parts.map((p, j) => j % 2 === 1 ? <Text key={j} style={mdStyles.inlineBold}>{p}</Text> : p)}
        </Text>
      );
    }
    return <Text key={i} style={mdStyles.body}>{line}</Text>;
  });
};

const LegalScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<Route>();
  const [activeDoc, setActiveDoc] = useState<keyof typeof LEGAL_CONTENT | null>(
    route.params?.title ? (
      LEGAL_DOCS.find(d => d.title === route.params.title)?.key ?? null
    ) : null
  );

  const handleShare = async () => {
    if (!activeDoc) return;
    const doc = LEGAL_DOCS.find(d => d.key === activeDoc);
    try {
      await Share.share({
        message: `${doc?.title} — Papzii\n\n${LEGAL_CONTENT[activeDoc]}`,
        title: `Papzii ${doc?.title}`,
      });
    } catch { /* ignore */ }
  };

  if (activeDoc) {
    const doc = LEGAL_DOCS.find(d => d.key === activeDoc)!;
    const content = LEGAL_CONTENT[activeDoc];
    return (
      <SafeAreaView style={s.safeArea}>
        <View style={s.docHeader}>
          <TouchableOpacity onPress={() => setActiveDoc(null)} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={s.docTitle} numberOfLines={1}>{doc.title}</Text>
          <TouchableOpacity onPress={handleShare} style={s.shareBtn}>
            <Ionicons name="share-outline" size={22} color="#94a3b8" />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={s.docContent} showsVerticalScrollIndicator={false}>
          {renderMarkdown(content)}
          <View style={{ height: 60 }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safeArea}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={s.pageTitle}>Legal & Policies</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={s.listContent}>
        <Text style={s.subtitle}>
          Papzii operates under South African law (POPIA, CPA, ECTA) and international standards.
          All documents are legally binding.
        </Text>

        {LEGAL_DOCS.map(doc => (
          <TouchableOpacity key={doc.key} style={s.docCard} onPress={() => setActiveDoc(doc.key)}>
            <View style={[s.docIconWrap, { backgroundColor: doc.color + '20' }]}>
              <Ionicons name={doc.icon as any} size={22} color={doc.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.docCardTitle}>{doc.title}</Text>
              <Text style={s.docCardSub}>Last updated March 2026</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#475569" />
          </TouchableOpacity>
        ))}

        <View style={s.infoCard}>
          <Ionicons name="information-circle" size={20} color="#3b82f6" />
          <Text style={s.infoText}>
            Governed by South African law. Information Regulator: inforeg@justice.gov.za
          </Text>
        </View>

        <View style={s.contactCard}>
          <Text style={s.contactTitle}>Legal Enquiries</Text>
          <Text style={s.contactLine}>📧 legal@papzii.co.za</Text>
          <Text style={s.contactLine}>📧 privacy@papzii.co.za</Text>
          <Text style={s.contactLine}>🌐 www.papzii.co.za</Text>
          <Text style={s.contactLine}>📍 Republic of South Africa</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0a0a14' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pageTitle: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  listContent: { padding: 20, paddingBottom: 60 },
  subtitle: { color: '#64748b', fontSize: 14, lineHeight: 22, marginBottom: 20 },
  docCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e293b', borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#334155', gap: 14 },
  docIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  docCardTitle: { color: '#fff', fontWeight: '700', fontSize: 15 },
  docCardSub: { color: '#64748b', fontSize: 12, marginTop: 2 },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#1e3a5f', borderRadius: 12, padding: 14, marginTop: 8, gap: 10 },
  infoText: { flex: 1, color: '#93c5fd', fontSize: 13, lineHeight: 20 },
  contactCard: { backgroundColor: '#1e293b', borderRadius: 16, padding: 18, marginTop: 14, borderWidth: 1, borderColor: '#334155' },
  contactTitle: { color: '#fff', fontWeight: '800', fontSize: 15, marginBottom: 12 },
  contactLine: { color: '#94a3b8', fontSize: 14, marginBottom: 6 },
  // Doc view
  docHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  docTitle: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  shareBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  docContent: { padding: 20 },
});

const mdStyles = StyleSheet.create({
  h1: { color: '#fff', fontSize: 22, fontWeight: '900', marginBottom: 12, marginTop: 8 },
  h2: { color: '#e2e8f0', fontSize: 17, fontWeight: '800', marginTop: 20, marginBottom: 8, borderBottomWidth: 1, borderBottomColor: '#1e293b', paddingBottom: 6 },
  h3: { color: '#cbd5e1', fontSize: 15, fontWeight: '700', marginTop: 14, marginBottom: 6 },
  divider: { height: 1, backgroundColor: '#1e293b', marginVertical: 12 },
  body: { color: '#94a3b8', fontSize: 14, lineHeight: 22 },
  bold: { color: '#cbd5e1', fontSize: 14, fontWeight: '800', lineHeight: 22 },
  inlineBold: { color: '#e2e8f0', fontWeight: '800' },
  bulletRow: { flexDirection: 'row', marginBottom: 6, paddingLeft: 8 },
  bulletDot: { color: '#8b5cf6', marginRight: 8, fontSize: 16, lineHeight: 22 },
  bulletText: { flex: 1, color: '#94a3b8', fontSize: 14, lineHeight: 22 },
  numbered: { color: '#94a3b8', fontSize: 14, lineHeight: 22, paddingLeft: 8, marginBottom: 4 },
  tableRow: { color: '#64748b', fontSize: 12, fontFamily: 'monospace', lineHeight: 20 },
});

export default LegalScreen;
