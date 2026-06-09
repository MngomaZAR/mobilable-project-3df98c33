let liveVideoAvailable: boolean | null = null;

const detectLiveVideoAvailability = () => {
  try {
    require('@livekit/react-native');
    return true;
  } catch {
    return false;
  }
};

export const isLiveVideoAvailable = () => {
  if (liveVideoAvailable == null) {
    liveVideoAvailable = detectLiveVideoAvailability();
  }
  return liveVideoAvailable;
};

export const LIVE_VIDEO_UNAVAILABLE_MESSAGE =
  'Live video calls require a compatible native build and configured LiveKit backend. Use chat or bookings if this device cannot join a room.';
