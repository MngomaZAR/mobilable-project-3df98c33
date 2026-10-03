import { Platform } from 'react-native';
import { invokeBackendFunction } from '../src/config/backendFunctions';
import { connectedSeconds, endBookingCall, getLiveVideoSDK, requestBookingCall } from '../src/utils/videoCalls';

jest.mock('../src/config/backendFunctions', () => ({ invokeBackendFunction: jest.fn() }));
jest.mock('@livekit/react-native', () => ({ registerGlobals: jest.fn() }));

const response = () => ({
  token: 'test-signed-token', url: 'wss://video.example.invalid', sessionId: 'session-1',
  bookingId: 'booking-1', billing: 'none', status: 'open',
  expiresAt: new Date(Date.now() + 120000).toISOString(), roomExpiresAt: new Date(Date.now() + 3600000).toISOString(),
});
const invoke = invokeBackendFunction as jest.Mock;

describe('Booking video protocol', () => {
  beforeEach(() => { jest.clearAllMocks(); invoke.mockResolvedValue({ data: response(), error: null }); });

  it('requests only the booking, never creator IDs, roles or grants', async () => {
    const session = await requestBookingCall('booking-1');
    expect(invoke).toHaveBeenCalledWith('livekit-token', { action: 'join', booking_id: 'booking-1' });
    expect(session.billing).toBe('none');
  });

  it.each(['', ' booking-1', 'booking-1\0', 'x'.repeat(121)])('rejects malformed booking IDs before invoking (%s)', async id => {
    await expect(requestBookingCall(id)).rejects.toThrow('accepted booking');
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    { bookingId: 'other-booking' }, { billing: 'metered' }, { status: 'ended' }, { token: true },
    { sessionId: 42 }, { url: 'ws://public.example.invalid' }, { url: 'https://video.example.invalid' },
    { url: 'ws://127.0.0.1:7880' },
    { url: 'wss://username:password@video.example.invalid' }, { url: 'wss://video.example.invalid?token=unsafe' },
    { url: 'wss://video.example.invalid#unsafe' }, { expiresAt: 'invalid' },
    { expiresAt: '2020-01-01T00:00:00Z' }, { roomExpiresAt: '2020-01-01T00:00:00Z' },
  ])('rejects unsafe or unconfirmed server responses %j', async override => {
    invoke.mockResolvedValue({ data: { ...response(), ...override }, error: null });
    await expect(requestBookingCall('booking-1')).rejects.toThrow();
  });

  it('propagates unavailable service without returning fake credentials', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'Booking is not accepted.' } });
    await expect(requestBookingCall('booking-1')).rejects.toThrow('Booking is not accepted.');
  });

  it('ends the authenticated session and distinguishes pending cleanup', async () => {
    const session = await requestBookingCall('booking-1');
    invoke.mockResolvedValue({ data: { sessionId: session.sessionId, status: 'ending', cleanup_pending: true }, error: null });
    expect((await endBookingCall(session)).status).toBe('ending');
    expect(invoke).toHaveBeenLastCalledWith('livekit-token', { action: 'end', booking_id: 'booking-1', session_id: 'session-1' });
    invoke.mockResolvedValue({ data: { sessionId: 'other', status: 'ended' }, error: null });
    await expect(endBookingCall(session)).rejects.toThrow('did not confirm');
  });

  it('counts connected intervals only and never negative elapsed time', () => {
    expect(connectedSeconds(8000, null, 999999)).toBe(8);
    expect(connectedSeconds(8000, 10000, 15000)).toBe(13);
    expect(connectedSeconds(8000, 20000, 15000)).toBe(8);
    expect(connectedSeconds(-1000, null)).toBe(0);
  });

  it('registers native globals once and does not expose a web native SDK', () => {
    const original = Platform.OS;
    try {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
      expect(getLiveVideoSDK()).not.toBeNull();
      getLiveVideoSDK();
      expect(require('@livekit/react-native').registerGlobals).toHaveBeenCalledTimes(1);
      Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
      expect(getLiveVideoSDK()).toBeNull();
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: original });
    }
  });
});
