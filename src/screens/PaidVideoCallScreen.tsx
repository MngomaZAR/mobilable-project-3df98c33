/**
 * PaidVideoCallScreen — LiveKit powered video call screen
 *
 * Integration: @livekit/react-native
 * Install: npx expo install @livekit/react-native livekit-client
 *
 * Architecture:
 *   - Server generates a LiveKit access token via a Supabase Edge Function
 *     (`livekit-token`) using the LiveKit server SDK + API key/secret (in env).
 *   - Client connects to the LiveKit Cloud (or self-hosted) room.
 *   - Billing: `video_call_sessions` table records start/end; a DB trigger
 *     writes an earnings row when the session ends.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Alert,
  Dimensions,
  Modal,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute } from '@react-navigation/native';
import { sendTip } from '../services/monetisationService';
import { trackEvent } from '../services/analyticsService';
import { supabase } from '../config/supabaseClient';
import { useAppData } from '../store/AppDataContext';
import Constants from 'expo-constants';

const { width, height } = Dimensions.get('window');

// ─────────────────────────────────────────────────────────────────────────────
// LiveKit lazy import — gracefully handled if package not yet installed
// ─────────────────────────────────────────────────────────────────────────────
let LiveKitRoom: React.ComponentType<any> | null = null;
let VideoView: React.ComponentType<any> | null = null;
let useTracks: (() => any[]) | null = null;
let Track: any = null;

if (Platform.OS !== 'web') {
  try {
    const lk = require('@livekit/react-native');
    LiveKitRoom = lk.LiveKitRoom;
    VideoView = lk.VideoView;
    useTracks = lk.useTracks;
    Track = lk.Track;
  } catch (_e) {
    // @livekit/react-native not yet installed — shows placeholder with install instructions
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component: active room video views (rendered inside LiveKitRoom context)
// ─────────────────────────────────────────────────────────────────────────────
const RoomParticipants: React.FC<{ creatorId: string }> = ({ creatorId }) => {
  const tracks = useTracks ? useTracks() : [];
  const remoteTracks = tracks.filter((t: any) => !t.participant?.isLocal && t.source === Track?.Source?.Camera);
  const localTrack = tracks.find((t: any) => t.participant?.isLocal && t.source === Track?.Source?.Camera);

  return (
    <View style={StyleSheet.absoluteFillObject}>
      {/* Remote (creator) video — full screen background */}
      {remoteTracks[0] && VideoView ? (
        <VideoView trackRef={remoteTracks[0]} style={StyleSheet.absoluteFillObject} objectFit="cover" />
      ) : (
        <View style={styles.noVideoPlaceholder}>
          <Ionicons name="person-circle" size={80} color="rgba(255,255,255,0.3)" />
          <Text style={styles.noVideoText}>Waiting for creator to join…</Text>
        </View>
      )}
      {/* Local (viewer) PiP preview */}
      {localTrack && VideoView ? (
        <View style={styles.localPreviewWrap}>
          <VideoView trackRef={localTrack} style={styles.localVideo} objectFit="cover" />
        </View>
      ) : (
        <View style={styles.localPreviewWrap}>
          <View style={[styles.localVideo, styles.cameraOffPlaceholder]}>
            <Ionicons name="videocam-off" size={28} color="rgba(255,255,255,0.4)" />
          </View>
        </View>
      )}
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────────────────────
const PaidVideoCallScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { adjustCredits, state } = useAppData();

  const creatorId: string | undefined = route.params?.creatorId;
  const role: 'creator' | 'viewer' =
    route.params?.role ??
    (creatorId && state.currentUser?.id === creatorId ? 'creator' : 'viewer');

  const [seconds, setSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [isTipping, setIsTipping] = useState(false);
  const [isGifting, setIsGifting] = useState(false);
  const [tipModalVisible, setTipModalVisible] = useState(false);
  const [tipAmount, setTipAmount] = useState('50');
  const [livekitToken, setLivekitToken] = useState<string | null>(null);
  const [livekitUrl, setLivekitUrl] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(true);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // ── Guard: creatorId is required ──────────────────────────────────────────
  useEffect(() => {
    if (!creatorId) {
      Alert.alert('Error', 'No creator specified for this call.', [
        { text: 'Go back', onPress: () => navigation.goBack() },
      ]);
    }
  }, [creatorId, navigation]);

  // ── Call timer ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // ── Fetch LiveKit token from Supabase Edge Function ───────────────────────
  const fetchToken = useCallback(async () => {
    if (!creatorId) return;
    setTokenLoading(true);
    setTokenError(null);
    try {
      const { data, error } = await supabase.functions.invoke('livekit-token', {
        body: { creator_id: creatorId, role },
      });
      if (error) throw error;
      if (!data?.token || !data?.url) throw new Error('Invalid token response from server.');
      setLivekitToken(data.token);
      setLivekitUrl(data.url);
    } catch (err: any) {
      setTokenError(err.message || 'Could not start video call.');
    } finally {
      setTokenLoading(false);
    }
  }, [creatorId]);

  useEffect(() => {
    fetchToken();
  }, [fetchToken]);

  // ── Tip handler ───────────────────────────────────────────────────────────
  const handleTip = async () => {
    if (!creatorId || !tipAmount || isNaN(Number(tipAmount))) return;
    setIsTipping(true);
    try {
      const amountNum = Number(tipAmount);
      const result = await sendTip(creatorId, amountNum, 'Great video call!');
      if (result.success) {
        setTipModalVisible(false);
        trackEvent('tip_sent', { creator_id: creatorId, amount: amountNum, source: 'video_call' });
        Platform.OS === 'web'
          ? alert('Tip sent!')
          : Alert.alert('Success', `R${amountNum} tip sent!`);
      } else {
        const msg = (result as any).error?.message || 'Unable to send tip.';
        Platform.OS === 'web' ? alert(msg) : Alert.alert('Error', msg);
      }
    } catch (e: any) {
      const friendly = e.message || 'Something went wrong.';
      Platform.OS === 'web' ? alert(friendly) : Alert.alert('Error', friendly);
    } finally {
      setIsTipping(false);
    }
  };

  const handleGift = async () => {
    if (!creatorId) return;
    try {
      setIsGifting(true);
      await adjustCredits(-10, 'live_gift', 'live_call', creatorId);
      Platform.OS === 'web'
        ? alert('Gift sent!')
        : Alert.alert('Success', 'Gift sent (10 credits).');
    } catch (e: any) {
      const msg = e?.message ?? 'Unable to send gift.';
      Platform.OS === 'web' ? alert(msg) : Alert.alert('Error', msg);
    } finally {
      setIsGifting(false);
    }
  };

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // ── LiveKit package not installed yet: show placeholder ───────────────────
  if (!LiveKitRoom) {
    const needsDevBuild = Constants?.appOwnership === 'expo';
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.notInstalledBanner}>
          <Ionicons name="videocam-outline" size={64} color="rgba(255,255,255,0.5)" />
          <Text style={styles.notInstalledTitle}>Video Call — LiveKit Setup Required</Text>
          <Text style={styles.notInstalledBody}>
            {needsDevBuild
              ? "Video calls require a development build. Expo Go does not include LiveKit native modules."
              : "Run the following in your project to enable video calls:\n\nnpx expo install @livekit/react-native livekit-client\n\nThen deploy the `livekit-token` Supabase Edge Function."
            }
          </Text>
          <TouchableOpacity style={styles.endCallBtn} onPress={() => navigation.goBack()}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Token error state ─────────────────────────────────────────────────────
  if (!tokenLoading && tokenError) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.notInstalledBanner}>
          <Ionicons name="alert-circle-outline" size={64} color="#ef4444" />
          <Text style={styles.notInstalledTitle}>Could not start call</Text>
          <Text style={styles.notInstalledBody}>{tokenError}</Text>
          <TouchableOpacity style={[styles.endCallBtn, { marginTop: 20 }]} onPress={fetchToken}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 12 }}>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontWeight: '600' }}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Loading token ─────────────────────────────────────────────────────────
  if (tokenLoading || !livekitToken || !livekitUrl) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.notInstalledBanner}>
          <Ionicons name="sync-outline" size={56} color="rgba(255,255,255,0.5)" />
          <Text style={styles.notInstalledTitle}>Connecting to call…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Main LiveKit room ─────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <LiveKitRoom
        token={livekitToken}
        serverUrl={livekitUrl}
        options={{ adaptiveStream: true, dynacast: true }}
        video={!cameraOff}
        audio={!isMuted}
        onDisconnected={() => navigation.goBack()}
      >
        {/* Remote and local video tracks */}
        <RoomParticipants creatorId={creatorId!} />

        {/* Gradient overlay with HUD */}
        <LinearGradient
          colors={['rgba(0,0,0,0.55)', 'transparent', 'rgba(0,0,0,0.75)']}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />

        {/* Top HUD */}
        <SafeAreaView edges={['top']} style={styles.hudTop}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </TouchableOpacity>
          <View style={styles.timerBadge}>
            <View style={styles.activeDot} />
            <Text style={styles.timerText}>{formatTime(seconds)}</Text>
            <Text style={styles.rateText}> · R15/min</Text>
          </View>
          <View style={{ width: 44 }} />
        </SafeAreaView>

        {/* Controls */}
        <SafeAreaView edges={['bottom']} style={styles.hudBottom}>
          <View style={styles.bottomActions}>
            <TouchableOpacity
              style={styles.tipBtn}
              onPress={() => setTipModalVisible(true)}
              disabled={isTipping}
            >
              <Ionicons name="heart" size={20} color="#fff" />
              <Text style={styles.tipBtnText}>Send Tip</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tipBtn, { backgroundColor: '#0ea5e9' }]}
              onPress={handleGift}
              disabled={isGifting}
            >
              <Ionicons name="gift" size={20} color="#fff" />
              <Text style={styles.tipBtnText}>
                {isGifting ? 'Sending…' : `Gift 10 (${state.creditsWallet?.balance ?? 0})`}
              </Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
          </View>
          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={[styles.controlBtn, isMuted && styles.controlBtnActive]}
              onPress={() => setIsMuted((m) => !m)}
              accessibilityLabel={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              <Ionicons name={isMuted ? 'mic-off' : 'mic'} size={24} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.controlBtn, styles.endCallBtnCircle]}
              onPress={() => navigation.goBack()}
              accessibilityLabel="End video call"
            >
              <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.controlBtn, cameraOff && styles.controlBtnActive]}
              onPress={() => setCameraOff((c) => !c)}
              accessibilityLabel={cameraOff ? 'Turn camera on' : 'Turn camera off'}
            >
              <Ionicons name={cameraOff ? 'videocam-off' : 'videocam'} size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </LiveKitRoom>

      {/* Tip Modal */}
      <Modal
        visible={tipModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setTipModalVisible(false)}
      >
        <View style={styles.modalBg}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Send Tip</Text>
              <TouchableOpacity onPress={() => setTipModalVisible(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.modalInput}
              keyboardType="numeric"
              value={tipAmount}
              onChangeText={setTipAmount}
              placeholder="50"
              placeholderTextColor="rgba(255,255,255,0.4)"
              autoFocus
            />
            <View style={styles.presets}>
              {['20', '50', '100', '500'].map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.presetBtn, tipAmount === p && styles.presetBtnActive]}
                  onPress={() => setTipAmount(p)}
                >
                  <Text style={styles.presetText}>R{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={styles.confirmBtn}
              onPress={handleTip}
              disabled={isTipping}
            >
              <Text style={styles.confirmBtnText}>{isTipping ? 'Sending…' : 'Confirm Tip'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  // HUD
  hudTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  hudBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444', marginRight: 8 },
  timerText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  rateText: { color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
  // Video placeholders
  noVideoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
  },
  noVideoText: { color: 'rgba(255,255,255,0.5)', marginTop: 12, fontWeight: '600' },
  localPreviewWrap: { position: 'absolute', bottom: 160, right: 20 },
  localVideo: { width: 110, height: 160, borderRadius: 16, overflow: 'hidden', backgroundColor: '#1e293b', borderWidth: 2, borderColor: '#fff' },
  cameraOffPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  // Controls
  controlsRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 24, paddingBottom: 20, paddingTop: 8 },
  controlBtn: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  controlBtnActive: { backgroundColor: '#ef4444' },
  endCallBtnCircle: { backgroundColor: '#ef4444', width: 70, height: 70, borderRadius: 35 },
  bottomActions: { flexDirection: 'row', alignItems: 'center', paddingTop: 16 },
  tipBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ec4899', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, gap: 8 },
  tipBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  // Not-installed / error state
  notInstalledBanner: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  notInstalledTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 20, textAlign: 'center' },
  notInstalledBody: { color: 'rgba(255,255,255,0.6)', fontSize: 14, marginTop: 12, textAlign: 'center', lineHeight: 22, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  endCallBtn: { backgroundColor: '#ef4444', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14, marginTop: 32 },
  // Tip modal
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1e293b', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalTitle: { color: '#fff', fontSize: 22, fontWeight: '800' },
  modalInput: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 16, padding: 20, color: '#fff', fontSize: 32, fontWeight: '800', textAlign: 'center', marginBottom: 16 },
  presets: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  presetBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  presetBtnActive: { backgroundColor: '#ec4899', borderColor: '#ec4899' },
  presetText: { color: '#fff', fontWeight: '700' },
  confirmBtn: { backgroundColor: '#ec4899', paddingVertical: 16, borderRadius: 16, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontSize: 18, fontWeight: '800' },
});

export default PaidVideoCallScreen;
