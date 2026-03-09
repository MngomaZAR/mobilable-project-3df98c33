import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useTheme } from '../store/ThemeContext';
import { useAppData } from '../store/AppDataContext';
import { subscribeToCreator } from '../services/monetisationService';
import { RootStackParamList } from '../navigation/types';

// Overloaded for this file
type Route = RouteProp<RootStackParamList, 'CreatorSubscriptions'>;
type Navigation = StackNavigationProp<RootStackParamList, 'CreatorSubscriptions'>;

export const CreatorSubscriptionsScreen: React.FC = () => {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { params } = useRoute<Route>();
  const creatorId = params?.creatorId;
  const { state } = useAppData();

  const [loadingId, setLoadingId] = useState<string | null>(null);

  const creator = (state.models.find(m => m.id === creatorId) || state.photographers.find(p => p.id === creatorId)) as any;
  const tiers = creator?.subscription_tiers || [
    { id: 'tier_1', name: 'Silver Supporter', price_zar: 99, benefits: ['Behind the scenes content', 'Priority booking'] },
    { id: 'tier_2', name: 'Gold VIP', price_zar: 249, benefits: ['All Silver benefits', '1 free print per month', 'Exclusive live streams'] },
  ];

  const handleSubscribe = async (tierId: string) => {
    setLoadingId(tierId);
    try {
      const result = await subscribeToCreator(creatorId, tierId);
      if (result.success) {
        Platform.OS === 'web' 
          ? alert('Subscription successful!') 
          : Alert.alert('Success', 'You are now subscribed to ' + (creator?.name || 'this creator'));
        navigation.goBack();
      } else {
        const errorMsg = result.error.message || 'Subscription failed.';
        Platform.OS === 'web' ? alert(errorMsg) : Alert.alert('Error', errorMsg);
      }
    } catch (e: any) {
      const friendly = e.message || 'Something went wrong.';
      Platform.OS === 'web' ? alert(friendly) : Alert.alert('Error', friendly);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Subscribe to {creator?.name}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Unlock exclusive content, priority access, and show your support by subscribing.
        </Text>
        
        {tiers.map((tier: any) => (
          <View key={tier.id} style={[styles.tierCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.tierHeader}>
              <Text style={[styles.tierName, { color: colors.text }]}>{tier.name}</Text>
              <Text style={[styles.tierPrice, { color: colors.accent }]}>R{tier.price_zar}/mo</Text>
            </View>
            <View style={styles.benefitsList}>
              {tier.benefits.map((benefit: string, i: number) => (
                <View key={i} style={styles.benefitRow}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.successGreen} />
                  <Text style={[styles.benefitText, { color: colors.text }]}>{benefit}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity 
              style={[styles.subBtn, { backgroundColor: colors.accent }]}
              onPress={() => handleSubscribe(tier.id)}
              disabled={loadingId !== null}
            >
              {loadingId === tier.id ? (
                <ActivityIndicator color={colors.card} />
              ) : (
                <Text style={[styles.subBtnText, { color: colors.card }]}>Subscribe Now</Text>
              )}
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: '800' },
  content: { padding: 16, paddingBottom: 40 },
  subtitle: { fontSize: 15, lineHeight: 22, marginBottom: 24 },
  tierCard: { padding: 20, borderRadius: 16, borderWidth: 1, marginBottom: 16 },
  tierHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  tierName: { fontSize: 18, fontWeight: '800' },
  tierPrice: { fontSize: 18, fontWeight: '900' },
  benefitsList: { marginBottom: 20, gap: 10 },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  benefitText: { fontSize: 14, flex: 1 },
  subBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  subBtnText: { fontWeight: '700', fontSize: 16 },
});

export default CreatorSubscriptionsScreen;
