import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import PaidVideoCallScreen from '../src/screens/PaidVideoCallScreen';
import { getLiveVideoSDK, requestBookingCall, endBookingCall } from '../src/utils/videoCalls';

let mockParams: any;
let mockConnection: string;
let mockMicrophone: boolean;
let mockCamera: boolean;
const mockGoBack = jest.fn();
const mockDisconnect = jest.fn();
const mockMic = jest.fn();
const mockCam = jest.fn();
const mockStartAudio = jest.fn();
const mockStopAudio = jest.fn();
const mockNavigation = { goBack: mockGoBack, addListener: jest.fn(() => jest.fn()) };
const mockRoom = { disconnect: mockDisconnect };
const mockTracks: any[] = [];

jest.mock('../src/config/backendFunctions', () => ({ invokeBackendFunction: jest.fn() }));
jest.mock('../src/hooks/useServiceAccess', () => ({ useServiceAccess: () => ({ allowed: () => true }) }));
jest.mock('../src/utils/videoCalls', () => ({
  ...jest.requireActual('../src/utils/videoCalls'),
  getLiveVideoSDK: jest.fn(), requestBookingCall: jest.fn(), endBookingCall: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: mockParams }),
  useNavigation: () => mockNavigation,
}));
jest.mock('livekit-client', () => ({ ConnectionState: { Connected: 'connected', Disconnected: 'disconnected' }, Track: { Source: { Camera: 'camera' } } }));

const sdk = {
  LiveKitRoom: ({ children }: any) => <>{children}</>, VideoTrack: () => null,
  AudioSession: { startAudioSession: mockStartAudio, stopAudioSession: mockStopAudio },
  useRoomContext: () => mockRoom,
  useConnectionState: () => mockConnection,
  useLocalParticipant: () => ({
    localParticipant: { setMicrophoneEnabled: mockMic, setCameraEnabled: mockCam },
    isMicrophoneEnabled: mockMicrophone, isCameraEnabled: mockCamera,
  }),
  useTracks: () => mockTracks,
};
const session = {
  token: 'test-token', url: 'wss://video.example.invalid', sessionId: 'session-1', bookingId: 'booking-1',
  billing: 'none', expiresAt: '2099-01-01T00:00:00Z', roomExpiresAt: '2099-01-01T01:00:00Z',
};
const joined = async () => {
  const view = render(<PaidVideoCallScreen />);
  await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Join booking call' })); });
  return view;
};

describe('Native booking call controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { bookingId: 'booking-1' };
    mockConnection = 'connected'; mockMicrophone = true; mockCamera = true;
    (getLiveVideoSDK as jest.Mock).mockReturnValue(sdk);
    (requestBookingCall as jest.Mock).mockResolvedValue(session);
    (endBookingCall as jest.Mock).mockResolvedValue({ sessionId: 'session-1', status: 'ended', cleanup_pending: false });
    for (const fn of [mockDisconnect, mockMic, mockCam, mockStartAudio, mockStopAudio]) fn.mockResolvedValue(undefined);
  });

  it('does not grant a call from legacy arbitrary creator or role parameters', () => {
    mockParams = { creatorId: 'someone', role: 'creator', testRoom: true };
    const view = render(<PaidVideoCallScreen />);
    expect(view.getByText('An accepted booking is required to join this call.')).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Join booking call' })).toBeNull();
    expect(requestBookingCall).not.toHaveBeenCalled();
  });

  it('shows unavailable builds honestly without requesting credentials', () => {
    (getLiveVideoSDK as jest.Mock).mockReturnValue(null);
    const view = render(<PaidVideoCallScreen />);
    expect(view.getByText('Video calling is unavailable on this build. Chat and bookings remain available.')).toBeTruthy();
    expect(requestBookingCall).not.toHaveBeenCalled();
  });

  it('joins by booking without metered billing, tips or earnings claims', async () => {
    const view = await joined();
    expect(requestBookingCall).toHaveBeenCalledWith('booking-1');
    expect(mockStartAudio).toHaveBeenCalledTimes(1);
    expect(view.queryByText(/R15|\btip\b|earnings|per minute/i)).toBeNull();
  });

  it('guards immediate double joining', async () => {
    let finish!: (value: unknown) => void;
    (requestBookingCall as jest.Mock).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<PaidVideoCallScreen />);
    const button = view.getByRole('button', { name: 'Join booking call' });
    act(() => { fireEvent.press(button); fireEvent.press(button); });
    expect(requestBookingCall).toHaveBeenCalledTimes(1);
    await act(async () => { finish(session); });
  });

  it('calls actual SDK microphone and camera track methods, not cosmetic toggles', async () => {
    const view = await joined();
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Mute microphone' })); });
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Turn camera off' })); });
    expect(mockMic).toHaveBeenCalledWith(false);
    expect(mockCam).toHaveBeenCalledWith(false);
    mockMicrophone = false; mockCamera = false;
    view.rerender(<PaidVideoCallScreen />);
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Unmute microphone' })); });
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Turn camera on' })); });
    expect(mockMic).toHaveBeenLastCalledWith(true);
    expect(mockCam).toHaveBeenLastCalledWith(true);
  });

  it('keeps failed media changes honest and disables tracks while disconnected', async () => {
    mockCam.mockRejectedValue(new Error('Permission denied'));
    const view = await joined();
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Turn camera off' })); });
    expect(view.getByText('Camera change failed. Check device permissions.')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Turn camera off' })).toBeTruthy();
    mockConnection = 'disconnected';
    view.rerender(<PaidVideoCallScreen />);
    expect(view.getByRole('button', { name: 'Mute microphone' })).toBeDisabled();
    expect(view.getByRole('button', { name: 'Reconnect booking call' })).toBeTruthy();
  });

  it('starts the timer only when connected, pausing reconnect intervals', async () => {
    mockConnection = 'connecting';
    const view = await joined();
    const now = jest.spyOn(Date, 'now').mockReturnValue(100000);
    const intervals = jest.spyOn(global, 'setInterval');
    const tick = () => {
      const callback = intervals.mock.calls.filter(call => call[1] === 1000).slice(-1)[0][0];
      (callback as () => void)();
    };
    try {
      now.mockReturnValue(105000);
      expect(view.getByText('Connecting | 0:00')).toBeTruthy();
      expect(intervals).not.toHaveBeenCalled();
      mockConnection = 'connected'; view.rerender(<PaidVideoCallScreen />);
      now.mockReturnValue(108000); act(tick);
      expect(view.getByText('Connected | 0:03')).toBeTruthy();
      mockConnection = 'reconnecting'; view.rerender(<PaidVideoCallScreen />);
      now.mockReturnValue(118000);
      expect(view.getByText('Connecting | 0:03')).toBeTruthy();
      mockConnection = 'connected'; view.rerender(<PaidVideoCallScreen />);
      now.mockReturnValue(120000); act(tick);
      expect(view.getByText('Connected | 0:05')).toBeTruthy();
    } finally {
      view.unmount();
      intervals.mockRestore(); now.mockRestore();
    }
  });

  it('requests durable cleanup even if local disconnect fails', async () => {
    mockDisconnect.mockRejectedValue(new Error('Disconnected already'));
    const view = await joined();
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'End booking call' })); });
    expect(endBookingCall).toHaveBeenCalledWith(session);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockStopAudio).toHaveBeenCalled();
  });

  it('does not claim an unconfirmed server end succeeded', async () => {
    (endBookingCall as jest.Mock).mockRejectedValue(new Error('Network unavailable'));
    const view = await joined();
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'End booking call' })); });
    expect(view.getByText(/server could not confirm call ending/)).toBeTruthy();
    expect(view.getByRole('button', { name: 'Leave call locally' })).toBeTruthy();
    expect(mockGoBack).not.toHaveBeenCalled();
  });
});
