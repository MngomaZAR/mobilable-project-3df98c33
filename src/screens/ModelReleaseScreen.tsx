import React, { useState, useEffect } from 'react';
import { 
  ScrollView, 
  StyleSheet, 
  Text, 
  TouchableOpacity, 
  View, 
  TextInput,
  Alert,
  ActivityIndicator,
  Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../store/ThemeContext';
import { useAppData } from '../store/AppDataContext';
import { fetchBookingContracts, signContract, createContract, Contract } from '../services/contractService';

type Route = RouteProp<RootStackParamList, 'ModelRelease'>;
type Navigation = StackNavigationProp<RootStackParamList>;

const ModelReleaseScreen: React.FC = () => {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { colors, isDark } = useTheme();
  const { currentUser } = useAppData();
  
  const [loading, setLoading] = useState(true);
  const [contract, setContract] = useState<Contract | null>(null);
  const [signature, setSignature] = useState('');
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    loadContract();
  }, [params.bookingId]);

  const loadContract = async () => {
    try {
      const contracts = await fetchBookingContracts(params.bookingId);
      const release = contracts.find(c => c.contract_type === 'model_release');
      
      if (release) {
        setContract(release);
      } else if (currentUser?.role === 'photographer') {
        // Auto-create a draft if photographer opens it and none exists
         const newContract = await createContract(
           params.bookingId, 
           'model_release', 
           'I hereby grant permission to the photographer to use my likeness in the photographs taken during this session for promotional and commercial purposes...'
         );
         setContract(newContract);
      }
    } catch (err: any) {
      Alert.alert('Error', 'Failed to load legal documents.');
    } finally {
      setLoading(false);
    }
  };

  const handleSign = async () => {
    if (!signature.trim()) {
      Alert.alert('Required', 'Please type your full name as a digital signature.');
      return;
    }

    if (!contract || !currentUser) return;

    setSigning(true);
    try {
      let role: 'creator' | 'client' | 'model' = 'client';
      if (currentUser.role === 'photographer') role = 'creator';
      if (currentUser.role === 'model') role = 'model';

      await signContract(contract.id, signature, role);
      Alert.alert('Success', 'Document signed successfully.');
      loadContract();
    } catch (err: any) {
      Alert.alert('Error', 'Failed to sign document.');
    } finally {
      setSigning(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (!contract) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg, padding: 24 }]}>
        <Ionicons name="document-text-outline" size={64} color={colors.textMuted} />
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          No model release has been generated for this booking yet.
        </Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Text style={{ color: colors.accent, fontWeight: '700' }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const userRole = currentUser?.role === 'photographer' ? 'creator' : (currentUser?.role === 'model' ? 'model' : 'client');
  const alreadySigned = (userRole === 'creator' && contract.creator_signature) || 
                       (userRole === 'client' && contract.client_signature) || 
                       (userRole === 'model' && contract.model_signature);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
            <View style={[styles.iconBox, { backgroundColor: colors.accent + '20' }]}>
                <Ionicons name="ribbon" size={24} color={colors.accent} />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>Model Release Form</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Legal Authorization & Usage Rights</Text>
        </View>

        <View style={[styles.paper, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.legalText, { color: colors.text }]}>{contract.content}</Text>
            
            <View style={styles.divider} />
            
            <View style={styles.signatures}>
                <View style={styles.sigBox}>
                    <Text style={[styles.sigLabel, { color: colors.textMuted }]}>Photographer</Text>
                    <Text style={[styles.sigValue, { color: colors.text }]}>{contract.creator_signature || 'Pending...'}</Text>
                </View>
                <View style={styles.sigBox}>
                    <Text style={[styles.sigLabel, { color: colors.textMuted }]}>Subject / Participant</Text>
                    <Text style={[styles.sigValue, { color: colors.text }]}>
                        {contract.client_signature || contract.model_signature || 'Pending...'}
                    </Text>
                </View>
            </View>
        </View>

        {!alreadySigned && (
            <View style={styles.signAction}>
                <Text style={[styles.prompt, { color: colors.text }]}>Type your full name to sign digitally</Text>
                <TextInput 
                    style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                    placeholder="Legal Full Name"
                    placeholderTextColor={colors.textMuted}
                    value={signature}
                    onChangeText={setSignature}
                />
                <TouchableOpacity 
                    style={[styles.primaryBtn, { backgroundColor: colors.text }]}
                    onPress={handleSign}
                    disabled={signing}
                >
                    <Text style={[styles.primaryBtnText, { color: colors.bg }]}>
                        {signing ? 'Signing...' : 'Sign & Complete'}
                    </Text>
                </TouchableOpacity>
            </View>
        )}

        {alreadySigned && (
            <View style={[styles.signedBadge, { backgroundColor: '#10b98120' }]}>
                <Ionicons name="checkmark-circle" size={20} color="#10b981" />
                <Text style={[styles.signedText, { color: '#10b981' }]}>You have signed this document.</Text>
            </View>
        )}

        <View style={styles.footer}>
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.textMuted} />
            <Text style={[styles.footerText, { color: colors.textMuted }]}>
                Tamper-evident digital record stored in Papzi Secure Vault.
            </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { padding: 20, paddingBottom: 60 },
  header: { alignItems: 'center', marginBottom: 24 },
  iconBox: { width: 48, height: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, marginTop: 4, fontWeight: '600' },
  paper: {
    padding: 24,
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 5,
    marginBottom: 24
  },
  legalText: { fontSize: 15, lineHeight: 24, fontStyle: 'italic' },
  divider: { height: 1, backgroundColor: 'rgba(0,0,0,0.05)', marginVertical: 24 },
  signatures: { gap: 16 },
  sigBox: { },
  sigLabel: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  sigValue: { fontSize: 18, fontWeight: '700', marginTop: 4, fontFamily: Platform.OS === 'ios' ? 'SnellRoundhand' : 'serif' },
  signAction: { gap: 12 },
  prompt: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  input: { height: 56, borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, fontSize: 16, fontWeight: '600' },
  primaryBtn: { height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', elevation: 2 },
  primaryBtnText: { fontSize: 16, fontWeight: '800' },
  signedBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16, borderRadius: 16, gap: 8 },
  signedText: { fontWeight: '700', fontSize: 15 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 32, gap: 8 },
  footerText: { fontSize: 12, fontWeight: '600' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { textAlign: 'center', marginTop: 16, fontSize: 16, lineHeight: 22 },
  backBtn: { marginTop: 24 },
});

export default ModelReleaseScreen;
