import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { supabase } from '../config/supabaseClient';
import { useAppData } from '../store/AppDataContext';
import { useTheme } from '../store/ThemeContext';
import { RootStackParamList } from '../navigation/types';
import { TIER_OPTIONS, CAMERA_OPTIONS, LENS_OPTIONS, LIGHTING_OPTIONS, EXTRA_OPTIONS } from '../constants/bookingOptions';

type Nav = StackNavigationProp<RootStackParamList>;

const EquipmentSetupScreen: React.FC = () => {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { state } = useAppData();
  const userId = state.currentUser?.id;

  const [selectedTier, setSelectedTier] = useState(TIER_OPTIONS[1].id);
  const [cameraBody, setCameraBody] = useState('');
  const [selectedLenses, setSelectedLenses] = useState<Set<string>>(new Set());
  const [selectedLighting, setSelectedLighting] = useState<Set<string>>(new Set());
  const [selectedExtras, setSelectedExtras] = useState<Set<string>>(new Set());
  const [customLens, setCustomLens] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    supabase.from('photographer_equipment').select('*').eq('photographer_id', userId).single()
      .then(({ data }) => {
        if (data) {
          setSelectedTier(data.tier_id ?? TIER_OPTIONS[1].id);
          setCameraBody(data.camera_body ?? '');
          setSelectedLenses(new Set(data.lenses ?? []));
          setSelectedLighting(new Set(data.lighting ? [data.lighting] : []));
          setSelectedExtras(new Set(data.extras ?? []));
        }
        setLoading(false);
      }).catch(() => setLoading(false));
  }, [userId]);

  const toggle = (set: Set<string>, val: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    next.has(val) ? next.delete(val) : next.add(val);
    setter(next);
  };

  const handleSave = async () => {
    if (!userId) return;
    if (!cameraBody.trim()) { Alert.alert('Camera body required', 'Enter your primary camera body.'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('photographer_equipment').upsert({
        photographer_id: userId,
        tier_id: selectedTier,
        camera_body: cameraBody.trim(),
        lenses: [...selectedLenses],
        lighting: [...selectedLighting][0] ?? null,
        extras: [...selectedExtras],
        updated_at: new Date().toISOString(),
      }, { onConflict: 'photographer_id' });
      if (error) throw error;
      await supabase.from('photographers').update({ tier_id: selectedTier }).eq('id', userId);
      Alert.alert('Saved!', 'Your gear profile is visible to clients when booking.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not save. Try again.');
    } finally { setSaving(false); }
  };

  const selectedTierData = TIER_OPTIONS.find(t => t.id === selectedTier);

  if (loading) return <View style={[s.center, { backgroundColor: colors.bg }]}><ActivityIndicator color="#c9a44a" size="large" /></View>;

  return (
    <SafeAreaView edges={['left', 'right']} style={[s.safe, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 60 }]} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}><Ionicons name="arrow-back" size={22} color={colors.text} /></TouchableOpacity>
        <Text style={[s.title, { color: colors.text }]}>Equipment & Tier</Text>
        <Text style={[s.sub, { color: colors.textSecondary }]}>Your gear tier sets your base rate like Uber X vs Uber Black. Clients see this when choosing.</Text>

        <Text style={[s.sectionLabel, { color: colors.text }]}>Service Tier</Text>
        {TIER_OPTIONS.map(tier => {
          const active = selectedTier === tier.id;
          return (
            <TouchableOpacity key={tier.id} style={[s.tierCard, { backgroundColor: colors.card, borderColor: active ? '#c9a44a' : colors.border }]} onPress={() => setSelectedTier(tier.id)}>
              <View style={[s.radio, { borderColor: active ? '#c9a44a' : colors.border }]}>{active && <View style={s.radioFill} />}</View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={[s.tierLabel, { color: active ? '#c9a44a' : colors.text }]}>{tier.label}</Text>
                  <Text style={[s.tierPrice, { color: active ? '#c9a44a' : colors.textSecondary }]}>From R{tier.basePrice.toLocaleString('en-ZA')}</Text>
                </View>
                <Text style={[s.tierSub, { color: colors.textSecondary }]}>{tier.summary}</Text>
              </View>
            </TouchableOpacity>
          );
        })}

        {selectedTierData && (
          <View style={s.infoBox}>
            <Ionicons name="information-circle-outline" size={15} color="#c9a44a" />
            <Text style={s.infoText}>Base from R{selectedTierData.basePrice.toLocaleString('en-ZA')} â€” equipment add-ons increase this</Text>
          </View>
        )}

        <Text style={[s.sectionLabel, { color: colors.text }]}>Camera Body *</Text>
        <TextInput style={[s.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]} placeholder="e.g. Sony A7 IV, Canon R5, Nikon Z8" placeholderTextColor={colors.textMuted} value={cameraBody} onChangeText={setCameraBody} />

        <Text style={[s.sectionLabel, { color: colors.text }]}>Lenses</Text>
        <View style={s.chips}>
          {LENS_OPTIONS.map(l => { const on = selectedLenses.has(l.id); return (
            <TouchableOpacity key={l.id} style={[s.chip, { borderColor: on ? '#c9a44a' : colors.border, backgroundColor: on ? '#c9a44a18' : colors.card }]} onPress={() => toggle(selectedLenses, l.id, setSelectedLenses)}>
              <Text style={[s.chipText, { color: on ? '#c9a44a' : colors.textSecondary }]}>{l.label} +R{l.price}</Text>
            </TouchableOpacity>
          ); })}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
          <TextInput style={[s.input, { flex: 1, marginBottom: 0, backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]} placeholder="Custom lens..." placeholderTextColor={colors.textMuted} value={customLens} onChangeText={setCustomLens} />
          <TouchableOpacity style={[s.addBtn, { borderColor: '#c9a44a', backgroundColor: '#c9a44a18' }]} onPress={() => { if (customLens.trim()) { toggle(selectedLenses, customLens.trim(), setSelectedLenses); setCustomLens(''); } }}>
            <Ionicons name="add" size={20} color="#c9a44a" />
          </TouchableOpacity>
        </View>

        <Text style={[s.sectionLabel, { color: colors.text }]}>Lighting</Text>
        <View style={s.chips}>
          {LIGHTING_OPTIONS.map(l => { const on = selectedLighting.has(l.id); return (
            <TouchableOpacity key={l.id} style={[s.chip, { borderColor: on ? '#3b82f6' : colors.border, backgroundColor: on ? '#3b82f618' : colors.card }]} onPress={() => toggle(selectedLighting, l.id, setSelectedLighting)}>
              <Text style={[s.chipText, { color: on ? '#3b82f6' : colors.textSecondary }]}>{l.label} +R{l.price}</Text>
            </TouchableOpacity>
          ); })}
        </View>

        <Text style={[s.sectionLabel, { color: colors.text }]}>Extras</Text>
        <View style={s.chips}>
          {EXTRA_OPTIONS.map(e => { const on = selectedExtras.has(e.id); return (
            <TouchableOpacity key={e.id} style={[s.chip, { borderColor: on ? '#10b981' : colors.border, backgroundColor: on ? '#10b98118' : colors.card }]} onPress={() => toggle(selectedExtras, e.id, setSelectedExtras)}>
              <Text style={[s.chipText, { color: on ? '#10b981' : colors.textSecondary }]}>{e.label} +R{e.price}</Text>
            </TouchableOpacity>
          ); })}
        </View>

        <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <><Ionicons name="checkmark-circle" size={20} color="#fff" /><Text style={s.saveBtnText}>Save Equipment Profile</Text></>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

export default EquipmentSetupScreen;

const s = StyleSheet.create({
  safe: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20 }, back: { marginBottom: 16, width: 36 },
  title: { fontSize: 26, fontWeight: '800', marginBottom: 8 },
  sub: { fontSize: 14, lineHeight: 21, marginBottom: 24 },
  sectionLabel: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10, marginTop: 20 },
  tierCard: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1.5, borderRadius: 14, padding: 14, marginBottom: 10 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioFill: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#c9a44a' },
  tierLabel: { fontSize: 15, fontWeight: '700' }, tierPrice: { fontSize: 13, fontWeight: '600' }, tierSub: { fontSize: 12, marginTop: 2 },
  infoBox: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 4, borderColor: '#c9a44a44', backgroundColor: '#c9a44a10' },
  infoText: { color: '#c9a44a', fontSize: 12, flex: 1 },
  input: { borderWidth: 1, borderRadius: 12, padding: 13, fontSize: 14, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 12, fontWeight: '600' },
  addBtn: { width: 46, height: 46, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#c9a44a', borderRadius: 16, paddingVertical: 16, marginTop: 24 },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
