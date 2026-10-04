import { Platform } from 'react-native';
import { invokeBackendFunction } from '../config/backendFunctions';
import { isRestrictedBeta } from '../config/betaPolicy';

type NativeSDK = typeof import('@livekit/react-native');
let nativeSDK: NativeSDK | null | undefined;

export const getLiveVideoSDK = (): NativeSDK | null => {
  if (isRestrictedBeta()) return null;
  if (Platform.OS === 'web') return null;
  if (nativeSDK !== undefined) return nativeSDK;
  try {
    const sdk: NativeSDK = require('@livekit/react-native');
    sdk.registerGlobals();
    nativeSDK = sdk;
  } catch {
    nativeSDK = null;
  }
  return nativeSDK;
};

export const isLiveVideoAvailable = () => getLiveVideoSDK() !== null;

export type BookingCallSession = {
  token: string;
  url: string;
  sessionId: string;
  bookingId: string;
  expiresAt: string;
  roomExpiresAt: string;
  billing: 'none';
};

export const requestBookingCall = async (bookingId: string): Promise<BookingCallSession> => {
  if (!bookingId || bookingId.length > 120 || bookingId !== bookingId.trim() || bookingId.includes('\0')) throw new Error('An accepted booking is required.');
  const { data, error } = await invokeBackendFunction('livekit-token', { action: 'join', booking_id: bookingId });
  if (error) throw new Error(error.message || 'The booking call is unavailable.');
  const url = typeof data?.url === 'string' ? new URL(data.url) : null;
  if (typeof data?.token !== 'string' || !data.token || typeof data?.sessionId !== 'string' || !data.sessionId ||
      data.bookingId !== bookingId || data.billing !== 'none' || data.status !== 'open' ||
      !url || url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash ||
      !Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) <= Date.now() ||
      !Number.isFinite(Date.parse(data.roomExpiresAt)) || Date.parse(data.roomExpiresAt) <= Date.now()) {
    throw new Error('The server did not return a valid booking call.');
  }
  return data as BookingCallSession;
};

export const endBookingCall = async (session: BookingCallSession) => {
  const { data, error } = await invokeBackendFunction('livekit-token', {
    action: 'end', booking_id: session.bookingId, session_id: session.sessionId,
  });
  if (error) throw new Error(error.message || 'The server could not end the call.');
  if (data?.sessionId !== session.sessionId || !['ended', 'ending'].includes(data.status) ||
      typeof data.cleanup_pending !== 'boolean' || (data.status === 'ending' && !data.cleanup_pending)) {
    throw new Error('The server did not confirm the end request.');
  }
  return data as { sessionId: string; status: 'ended' | 'ending'; cleanup_pending: boolean };
};

export const connectedSeconds = (elapsedMs: number, connectedAt: number | null, now = Date.now()) =>
  Math.floor(Math.max(0, elapsedMs + (connectedAt === null ? 0 : Math.max(0, now - connectedAt))) / 1000);

export const LIVE_VIDEO_UNAVAILABLE_MESSAGE =
  'Video calling is unavailable on this build. Chat and bookings remain available.';
