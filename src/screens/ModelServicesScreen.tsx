import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View, Switch,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { supabase } from '../config/supabaseClient';
import { useAppData } from '../store/AppDataContext';
import { useTheme } from '../store/ThemeContext';
import { RootStackParamList } from '../navigation/types';

type Nav = StackNavigationProp<RootStackParamList>;

const SERVICE_TEMPLATES = [
  // Promotion
  { key: 'brand_ambassador',  label: 'Brand Ambassador',    desc: 'Represent brands at events + social posts', rate: 2500, adult: false, icon: 'megaphone-outline',      cat: 'Promotion & Brand' },
  { key: 'product_shoot',     label: 'Product Shoot',       desc: 'Modelling with products for ads',           rate: 1800, adult: false, icon: 'camera-outline',         cat: 'Promotion & Brand' },
  { key: 'event_hosting',     label: 'Event Hosting / MC',  desc: 'Corporate & private event hosting',         rate: 3500, adult: false, icon: 'mic-outline',            cat: 'Promotion & Brand' },
  { key: 'social_promo',      label: 'Social Media Promo',  desc: 'Instagram / TikTok / YouTube content',     rate: 1500, adult: false, icon: 'logo-instagram',         cat: 'Promotion & Brand' },
  // Collaboration
  { key: 'fashion_shoot',     label: 'Fashion Shoot',       desc: 'Editorial, lookbook, runway',               rate: 2200, adult: false, icon: 'shirt-outline',          cat: 'Collaboration' },
  { key: 'music_video',       label: 'Music Video',         desc: 'Acting / modelling in music videos',        rate: 4000, adult: false, icon: 'musical-notes-outline',  cat: 'Collaboration' },
  { key: 'film_extra',        label: 'Film / TV Extra',     desc: 'Background or supporting roles',            rate: 1200, adult: false, icon: 'film-outline',           cat: 'Collaboration' },
  // Adult (age-verified only)
  { key: 'lingerie_shoot',    label: 'Lingerie / Swimwear', desc: 'Tasteful lingerie or swimwear modelling',   rate: 3000, adult: true,  icon: 'body-outline',           cat: 'Adult Content (18+)' },
  { key: 'boudoir',           label: 'Boudoir Session',     desc: 'Intimate tasteful boudoir photography',     rate: 3500, adult: true,  icon: 'rose-outline',           cat: 'Adult Content (18+)' },
  { key: 'adult_content',     label: 'Adult Content',       desc: 'Explicit adult content â€” age verification required', rate: 5000, adult: true, icon: 'lock-closed-outline', cat: 'Adult Content (18+)' },
];

const ModelServicesScreen: React.FC = () => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { state } = useAppData();
  const userId = state.currentUser?.id;
  const isAgeVerified = state.currentUser?.age_verified === true;

  const [services, setServices] = useState<Record<string, { active: boolean; rate: number }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    supabase.from('model_services').select('service_type, is_active, rate_zar').eq('model_id', userId)
      .then(({ data }) => {
        const map: typeof services = {};
        (data ?? []).forEach((r: any) => { map[r.service_type] = { active: r.is_active, rate: Number(r.rate_zar ?? 0) }; });
        setServices(map);
        setLoading(false);
      }).catch(() => setLoading(false));
  }, [userId]);

  const toggle = (key: string, template: typeof SERVICE_TEMPLATES[0]) => {
    if (template.adult && !isAgeVerified) {
      Alert.alert('Age Verification Required', 'Complete age verification (18+) to enable adult content services.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Verify Now', onPress: () => navigation.navigate('AgeVerification') },
      ]);
      return;
    }
    setServices(prev => {
      const cur = prev[key] ?? { active: false, rate: template.rate };
      return { ...prev, [key]: { ...cur, active: !cur.active } };
    });
  };

  const setRate = (key: string, val: string) => {
    const n = parseInt(val.replace(/\D/g, ''), 10) || 0;
    setServices(prev => ({ ...prev, [key]: { ...(prev[key] ?? { active: false }), rate: n } }));
  };

  const handleSave = async () => {
    if (!userId) return;
    setSaving(true);
    try {
      await supabase.from('model_services').update({ is_active: false }).eq('model_id', userId);
      const active = Object.entries(services).filter(([, v]) => v.active).map(([key, v]) => ({
        model_id: userId,
        service_type: key,
        rate_zar: v.rate,
        is_active: true,
        requires_age_verification: SERVICE_TEMPLATES.find(t => t.key === key)?.adult ?? false,
      }));
      if (active.length > 0) {
        const { error } = await supabase.from('model_services').upsert(active, { onConflict: 'model_id,service_type' });
        if (error) throw error;
      }
      Alert.alert('Saved!', 'Your services are now visible to clients.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not save. Try again.');
    } finally { setSaving(false); }
  };

  const categories = [...new Set(SERVICE_TEMPLATES.map(t => t.cat))];

  if (loading) return <View style={[s.center, { backgroundColor: colors.bg }]}><ActivityIndicator color="#c9a44a" size="large" /></View>;

  return (
    <SafeAreaView edges={['left', 'right']} style={[s.safe, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 60 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}><Ionicons name="arrow-back" size={22} color={colors.text} /></TouchableOpacity>
        <Text style={[s.title, { color: colors.text }]}>Services & Rates</Text>
        <Text style={[s.sub, { color: colors.textSecondary }]}>Enable what you offer and set your rate per session. Clients book directly based on what's active.</Text>

        {!isAgeVerified && (
          <TouchableOpacity style={[s.verifyBanner, { borderColor: '#f59e0b', backgroundColor: '#f59e0b18' }]} onPress={() => navigation.navigate('AgeVerification')}>
            <Ionicons name="alert-circle-outline" size={16} color="#f59e0b" />
            <Text style={s.verifyText}>Complete age verification to unlock adult content services â†’</Text>
          </TouchableOpacity>
        )}

        {categories.map(cat => (
          <View key={cat}>
            <Text style={[s.catLabel, { color: colors.text }]}>{cat}</Text>
            {SERVICE_TEMPLATES.filter(t => t.cat === cat).map(template => {
              const svc = services[template.key] ?? { active: false, rate: template.rate };
              const locked = template.adult && !isAgeVerified;
              return (
                <View key={template.key} style={[s.card, { backgroundColor: colors.card, borderColor: svc.active ? '#c9a44a' : colors.border, opacity: locked ? 0.55 : 1 }]}>
                  <View style={s.cardRow}>
                    <View style={[s.icon, { backgroundColor: svc.active ? '#c9a44a18' : colors.bg }]}>
                      <Ionicons name={template.icon as any} size={18} color={svc.active ? '#c9a44a' : colors.textMuted} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={[s.cardLabel, { color: colors.text }]}>{template.label}</Text>
                        {template.adult && <View style={s.adultBadge}><Text style={s.adultText}>18+</Text></View>}
                      </View>
                      <Text style={[s.cardDesc, { color: colors.textSecondary }]}>{template.desc}</Text>
                    </View>
                    <Switch value={svc.active} onValueChange={() => toggle(template.key, template)} trackColor={{ false: colors.border, true: '#c9a44a' }} thumbColor="#fff" disabled={locked} />
                  </View>
                  {svc.active && (
                    <View style={[s.rateRow, { borderTopColor: colors.border }]}>
                      <Text style={[s.rateLabel, { color: colors.textSecondary }]}>Rate / session (ZAR)</Text>
                      <View style={[s.rateInput, { borderColor: colors.border, backgroundColor: colors.bg }]}>
                        <Text style={{ color: '#c9a44a', fontWeight: '700' }}>R</Text>
                        <TextInput style={[s.rateField, { color: colors.text }]} value={svc.rate > 0 ? String(svc.rate) : ''} onChangeText={v => setRate(template.key, v)} keyboardType="numeric" placeholder={String(template.rate)} placeholderTextColor={colors.textMuted} />
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        ))}

        <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <><Ionicons name="checkmark-circle" size={20} color="#fff" /><Text style={s.saveBtnText}>Save Services</Text></>}
        </TouchableOpacity>
        <Text style={[s.legal, { color: colors.textMuted }]}>By enabling services you confirm you are legally permitted to offer them and consent to our Terms of Service. Adult content requires POPIA compliance and verified age.</Text>
      </ScrollView>
    </SafeAreaView>
  );
};

export default ModelServicesScreen;

const s = StyleSheet.create({
  safe: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20 }, back: { marginBottom: 16, width: 36 },
  title: { fontSize: 26, fontWeight: '800', marginBottom: 8 },
  sub: { fontSize: 14, lineHeight: 21, marginBottom: 16 },
  verifyBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 20 },
  verifyText: { color: '#f59e0b', fontSize: 13, fontWeight: '600', flex: 1 },
  catLabel: { fontSize: 14, fontWeight: '800', marginTop: 20, marginBottom: 10 },
  card: { borderWidth: 1.5, borderRadius: 14, padding: 14, marginBottom: 10 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardLabel: { fontSize: 14, fontWeight: '700' },
  cardDesc: { fontSize: 12, marginTop: 2 },
  adultBadge: { backgroundColor: '#ef444420', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1, borderColor: '#ef4444' },
  adultText: { color: '#ef4444', fontSize: 10, fontWeight: '800' },
  rateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1 },
  rateLabel: { fontSize: 13 },
  rateInput: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, gap: 4 },
  rateField: { fontSize: 14, fontWeight: '700', minWidth: 70 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#c9a44a', borderRadius: 16, paddingVertical: 16, marginTop: 24, marginBottom: 12 },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  legal: { fontSize: 11, textAlign: 'center', lineHeight: 16 },
});
