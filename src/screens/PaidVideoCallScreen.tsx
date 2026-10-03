import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Platform, StatusBar, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ConnectionState, Track } from 'livekit-client';
import {
  BookingCallSession, connectedSeconds, endBookingCall, getLiveVideoSDK,
  LIVE_VIDEO_UNAVAILABLE_MESSAGE, requestBookingCall,
} from '../utils/videoCalls';

type NativeSDK = NonNullable<ReturnType<typeof getLiveVideoSDK>>;

const CallRoom: React.FC<{
  sdk: NativeSDK; ending: boolean; error: string | null;
  onEnd: () => Promise<void>; onRetry: () => Promise<void>;
  onRoom: (room: ReturnType<NativeSDK['useRoomContext']> | null) => void;
}> = ({ sdk, ending, error, onEnd, onRetry, onRoom }) => {
  const room = sdk.useRoomContext();
  const connection = sdk.useConnectionState();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = sdk.useLocalParticipant();
  const tracks = sdk.useTracks([Track.Source.Camera]);
  const remote = tracks.filter((track) => !track.participant.isLocal);
  const local = tracks.find((track) => track.participant.isLocal);
  const [controlError, setControlError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'microphone' | 'camera' | null>(null);
  const busyRef = useRef(false);
  const [seconds, setSeconds] = useState(0);
  const accumulated = useRef(0);
  const connectedAt = useRef<number | null>(null);
  const isConnected = connection === ConnectionState.Connected;

  useEffect(() => {
    onRoom(room);
    return () => onRoom(null);
  }, [room, onRoom]);

  useEffect(() => {
    if (!isConnected) {
      setSeconds(connectedSeconds(accumulated.current, null));
      return;
    }
    connectedAt.current = Date.now();
    const timer = setInterval(() => setSeconds(connectedSeconds(accumulated.current, connectedAt.current)), 1000);
    return () => {
      if (connectedAt.current !== null) accumulated.current += Math.max(0, Date.now() - connectedAt.current);
      connectedAt.current = null;
      clearInterval(timer);
    };
  }, [isConnected]);

  const toggle = async (control: 'microphone' | 'camera') => {
    if (busyRef.current || !isConnected || ending) return;
    busyRef.current = true;
    setBusy(control);
    setControlError(null);
    try {
      if (control === 'microphone') await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
      else await localParticipant.setCameraEnabled(!isCameraEnabled);
    } catch {
      setControlError(control === 'microphone' ? 'Microphone change failed. Check device permissions.' : 'Camera change failed. Check device permissions.');
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const status = isConnected ? 'Connected' : connection === ConnectionState.Disconnected ? 'Disconnected' : 'Connecting';
  const VideoTrack = sdk.VideoTrack;
  const controlsDisabled = !isConnected || ending || busy !== null;

  return (
    <View style={styles.container}>
      <View style={styles.remoteGrid}>
        {remote.length > 0 ? remote.map((track) => (
          <VideoTrack key={track.participant.identity} trackRef={track} style={styles.remoteVideo} objectFit="cover" />
        )) : (
          <View style={styles.placeholder}>
            <Ionicons name="person-circle-outline" size={72} color="#a1a1aa" />
            <Text style={styles.secondary}>Waiting for another booking participant</Text>
          </View>
        )}
      </View>
      <View style={styles.localPreview}>
        {local && isCameraEnabled ? (
          <VideoTrack trackRef={local} style={styles.localVideo} objectFit="cover" />
        ) : <Ionicons name="videocam-off-outline" size={28} color="#fff" />}
      </View>
      <SafeAreaView edges={['top']} style={styles.topBar}>
        <Text style={styles.heading}>Booking call</Text>
        <Text accessibilityLiveRegion="polite" style={styles.secondary}>{status} | {time}</Text>
      </SafeAreaView>
      <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
        {(error || controlError) && <Text accessibilityRole="alert" style={styles.error}>{error || controlError}</Text>}
        {connection === ConnectionState.Disconnected && !ending && !error && (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Reconnect booking call" style={styles.action} onPress={() => void onRetry()}>
            <Ionicons name="refresh-outline" size={20} color="#fff" /><Text style={styles.actionText}>Reconnect</Text>
          </TouchableOpacity>
        )}
        {error && !ending && (
          <TouchableOpacity accessibilityRole="button" style={styles.action} onPress={() => void onEnd()}>
            <Ionicons name="call-outline" size={20} color="#fff" /><Text style={styles.actionText}>End call</Text>
          </TouchableOpacity>
        )}
        <View style={styles.controls}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
            accessibilityState={{ disabled: controlsDisabled, selected: !isMicrophoneEnabled }}
            disabled={controlsDisabled} style={[styles.control, !isMicrophoneEnabled && styles.controlOff, controlsDisabled && styles.disabled]}
            onPress={() => void toggle('microphone')}>
            <Ionicons name={isMicrophoneEnabled ? 'mic-outline' : 'mic-off-outline'} size={26} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="End booking call" accessibilityState={{ disabled: ending }}
            disabled={ending} style={[styles.control, styles.hangup]}
            onPress={() => void onEnd()}>
            {ending ? <ActivityIndicator color="#fff" /> : <Ionicons name="call-outline" size={28} color="#fff" />}
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
            accessibilityState={{ disabled: controlsDisabled, selected: !isCameraEnabled }}
            disabled={controlsDisabled} style={[styles.control, !isCameraEnabled && styles.controlOff, controlsDisabled && styles.disabled]}
            onPress={() => void toggle('camera')}>
            <Ionicons name={isCameraEnabled ? 'videocam-outline' : 'videocam-off-outline'} size={26} color="#fff" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
};

const PaidVideoCallScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const bookingId = typeof route.params?.bookingId === 'string' ? route.params.bookingId : '';
  const sdk = useMemo(() => getLiveVideoSDK(), []);
  const [session, setSession] = useState<BookingCallSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roomKey, setRoomKey] = useState(0);
  const mounted = useRef(true);
  const sessionRef = useRef<BookingCallSession | null>(null);
  const roomRef = useRef<ReturnType<NativeSDK['useRoomContext']> | null>(null);
  const onRoom = useCallback((room: ReturnType<NativeSDK['useRoomContext']> | null) => { roomRef.current = room; }, []);
  const requestVersion = useRef(0);
  const joiningRef = useRef(false);
  const endingRef = useRef(false);
  const allowLeave = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestVersion.current++;
      if (sessionRef.current) void endBookingCall(sessionRef.current).catch(() => {});
      if (sdk) void sdk.AudioSession.stopAudioSession().catch(() => {});
    };
  }, [sdk]);

  const join = useCallback(async () => {
    if (!sdk || !bookingId || joiningRef.current || endingRef.current) return;
    joiningRef.current = true;
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    setSession(null);
    try {
      const credentials = await requestBookingCall(bookingId);
      if (!mounted.current || version !== requestVersion.current) {
        void endBookingCall(credentials).catch(() => {});
        return;
      }
      sessionRef.current = credentials;
      await sdk.AudioSession.startAudioSession();
      if (!mounted.current || version !== requestVersion.current) {
        await sdk.AudioSession.stopAudioSession();
        return;
      }
      setSession(credentials);
      setRoomKey((value) => value + 1);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'The booking call could not be started.');
      await sdk.AudioSession.stopAudioSession().catch(() => {});
    } finally {
      joiningRef.current = false;
      if (mounted.current && version === requestVersion.current) setLoading(false);
    }
  }, [bookingId, sdk]);

  const end = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    requestVersion.current++;
    setEnding(true);
    setError(null);
    try {
      if (roomRef.current) await roomRef.current.disconnect().catch(() => {});
      if (sessionRef.current) await endBookingCall(sessionRef.current);
      sessionRef.current = null;
      allowLeave.current = true;
      navigation.goBack();
    } catch {
      if (mounted.current) setError('The server could not confirm call ending. Retry, or leave locally; room cleanup may still be pending.');
    } finally {
      if (sdk) await sdk.AudioSession.stopAudioSession().catch(() => {});
      endingRef.current = false;
      if (mounted.current) setEnding(false);
    }
  }, [navigation, sdk]);

  useEffect(() => navigation.addListener('beforeRemove', (event: any) => {
    if (!sessionRef.current || allowLeave.current) return;
    event.preventDefault();
    void end();
  }), [navigation, end]);

  const leaveLocally = () => {
    allowLeave.current = true;
    navigation.goBack();
  };

  if (!session || !sdk) {
    const unavailable = !sdk ? LIVE_VIDEO_UNAVAILABLE_MESSAGE : !bookingId ? 'An accepted booking is required to join this call.' : null;
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.idle}>
          <Ionicons name="videocam-outline" size={54} color="#a1a1aa" />
          <Text style={styles.title}>Booking call</Text>
          <Text style={styles.secondary}>{unavailable || (loading ? 'Preparing call...' : 'Ready to join')}</Text>
          {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          {!unavailable && (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Join booking call" disabled={loading || ending}
              style={[styles.action, (loading || ending) && styles.disabled]} onPress={() => void join()}>
              {loading ? <ActivityIndicator color="#fff" /> : <Ionicons name="videocam-outline" size={20} color="#fff" />}
              <Text style={styles.actionText}>Join call</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity accessibilityRole="button" style={styles.action} onPress={() => void end()}>
            <Text style={styles.actionText}>Back to booking</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const LiveKitRoom = sdk.LiveKitRoom;
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LiveKitRoom key={roomKey} token={session.token} serverUrl={session.url} connect audio video
        options={{ adaptiveStream: { pixelDensity: 'screen' }, dynacast: true }}
        onError={() => setError('Video connection failed. End this booking call or leave locally.')}
        onMediaDeviceFailure={() => setError('Camera or microphone unavailable. Check device permissions.')}
        onEncryptionError={() => setError('The video connection could not be secured.')}>
        <CallRoom sdk={sdk} ending={ending} error={error} onEnd={end} onRetry={join} onRoom={onRoom} />
      </LiveKitRoom>
      {error && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Leave call locally" style={styles.leave} onPress={leaveLocally}>
        <Text style={styles.actionText}>Leave locally</Text>
      </TouchableOpacity>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#18181b' },
  remoteGrid: { flex: 1 },
  remoteVideo: { flex: 1, width: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 20, paddingBottom: 12, backgroundColor: '#18181bcc' },
  heading: { fontSize: 18, color: '#fff', fontWeight: '700' },
  secondary: { color: '#d4d4d8', fontSize: 14, lineHeight: 22, textAlign: 'center', marginTop: 8 },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: '#18181bcc' },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: 24, paddingVertical: 12 },
  control: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3f3f46' },
  controlOff: { backgroundColor: '#52525b' },
  hangup: { backgroundColor: '#dc2626' },
  disabled: { opacity: 0.5 },
  localPreview: { position: 'absolute', right: 16, top: 120, width: 108, height: 152, borderRadius: 8, overflow: 'hidden', backgroundColor: '#27272a', alignItems: 'center', justifyContent: 'center' },
  localVideo: { width: '100%', height: '100%' },
  idle: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 16 },
  title: { color: '#fff', fontSize: 24, fontWeight: '700' },
  action: { minWidth: 160, minHeight: 44, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#3f3f46' },
  actionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  error: { color: '#fda4af', fontSize: 14, lineHeight: 20, textAlign: 'center', paddingHorizontal: 12 },
  leave: { position: 'absolute', top: Platform.OS === 'ios' ? 88 : 68, right: 16, backgroundColor: '#3f3f46', padding: 12, borderRadius: 6 },
});

export default PaidVideoCallScreen;
