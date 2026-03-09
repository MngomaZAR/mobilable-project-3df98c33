import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Image, Dimensions, StatusBar, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { sendTip } from '../services/monetisationService';
import { trackEvent } from '../services/analyticsService';

// Fallback for expo-blur
const BlurView = ({ children, style }: any) => <View style={[{ backgroundColor: 'rgba(0,0,0,0.6)' }, style]}>{children}</View>;

const { width, height } = Dimensions.get('window');

const PaidVideoCallScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<any>();
  const [seconds, setSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [isTipping, setIsTipping] = useState(false);

  const creatorId = route.params?.creatorId || 'a1000001-0000-0000-0000-000000000001';

  const handleTip = async () => {
    setIsTipping(true);
    try {
      const result = await sendTip(creatorId, 50, 'Great video call!');
      if (result.success) {
        trackEvent('tip_sent', { creator_id: creatorId, amount: 50, source: 'video_call' });
        Platform.OS === 'web' ? alert('Tip sent!') : Alert.alert('Success', '50 ZAR tip sent!');
      } else {
        const errorMsg = result.error.message || 'Unable to send tip.';
        Platform.OS === 'web' ? alert(errorMsg) : Alert.alert('Error', errorMsg);
      }
    } catch (e: any) {
      console.warn(e);
      const friendly = e.message || 'Something went wrong.';
      Platform.OS === 'web' ? alert(friendly) : Alert.alert('Error', friendly);
    } finally {
      setIsTipping(false);
    }
  };

  useEffect(() => {
    const timer = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      {/* Remote Video (Client View / Model View placeholder) */}
      <Image 
        source={{ uri: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=1000' }} 
        style={styles.remoteVideo} 
      />

      <LinearGradient
        colors={['rgba(0,0,0,0.6)', 'transparent', 'rgba(0,0,0,0.8)']}
        style={styles.overlay}
      >
        <SafeAreaView style={styles.content}>
          <View style={styles.topRow}>
            <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
              <Ionicons name="chevron-back" size={28} color="#fff" />
            </TouchableOpacity>
            <BlurView intensity={30} tint="dark" style={styles.timerBadge}>
              <View style={styles.activeDot} />
              <Text style={styles.timerText}>{formatTime(seconds)}</Text>
              <Text style={styles.rateText}> • R15/min</Text>
            </BlurView>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.spacer} />

          {/* Local Video Preview */}
          <View style={styles.localPreviewWrap}>
             <View style={styles.localVideo}>
               {!cameraOff ? (
                 <Image 
                   source={{ uri: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&q=80&w=300' }} 
                   style={styles.localImg} 
                 />
               ) : (
                 <View style={styles.cameraOffPlaceholder}>
                    <Ionicons name="videocam-off" size={32} color="#475569" />
                 </View>
               )}
             </View>
          </View>

          {/* Interaction UI */}
          <View style={styles.controlsRow}>
             <TouchableOpacity 
               style={[styles.controlBtn, isMuted && styles.controlBtnActive]} 
               onPress={() => setIsMuted(!isMuted)}
               accessibilityLabel={isMuted ? 'Unmute microphone' : 'Mute microphone'}
             >
               <Ionicons name={isMuted ? "mic-off" : "mic"} size={24} color="#fff" />
             </TouchableOpacity>

             <TouchableOpacity 
               style={[styles.controlBtn, styles.endCallBtn]} 
               onPress={() => navigation.goBack()}
               accessibilityLabel="End video call"
             >
               <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
             </TouchableOpacity>

             <TouchableOpacity 
               style={[styles.controlBtn, cameraOff && styles.controlBtnActive]} 
               onPress={() => setCameraOff(!cameraOff)}
               accessibilityLabel={cameraOff ? 'Turn camera on' : 'Turn camera off'}
             >
               <Ionicons name={cameraOff ? "videocam-off" : "videocam"} size={24} color="#fff" />
             </TouchableOpacity>
          </View>

          <View style={styles.bottomActions}>
             <TouchableOpacity style={styles.tipBtn} onPress={handleTip} disabled={isTipping}>
                <Ionicons name="heart" size={20} color="#fff" />
                <Text style={styles.tipBtnText}>{isTipping ? 'Sending...' : 'Send Tip'}</Text>
             </TouchableOpacity>
             <TouchableOpacity style={styles.effectsBtn}>
                <Ionicons name="sparkles" size={20} color="#fff" />
             </TouchableOpacity>
          </View>
        </SafeAreaView>
      </LinearGradient>
    </View>
  );
};

// Internal SafeAreaView replacement for simple integration
const SafeAreaView = ({ children, style }: any) => <View style={[{ flex: 1, paddingTop: 50 }, style]}>{children}</View>;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  remoteVideo: { width: width, height: height, position: 'absolute' },
  overlay: { flex: 1 },
  content: { flex: 1, padding: 20, justifyContent: 'space-between' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' },
  timerBadge: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 14, 
    paddingVertical: 8, 
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444', marginRight: 8 },
  timerText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  rateText: { color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
  spacer: { flex: 1 },
  localPreviewWrap: { alignItems: 'flex-end', marginBottom: 20 },
  localVideo: { width: 110, height: 160, borderRadius: 16, overflow: 'hidden', backgroundColor: '#1e293b', borderWidth: 2, borderColor: '#fff' },
  localImg: { width: '100%', height: '100%' },
  cameraOffPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
    marginBottom: 30,
  },
  controlBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlBtnActive: { backgroundColor: '#ef4444' },
  endCallBtn: { backgroundColor: '#ef4444', width: 70, height: 70, borderRadius: 35 },
  bottomActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  tipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ec4899',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    gap: 8,
  },
  tipBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  effectsBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
});

export default PaidVideoCallScreen;
