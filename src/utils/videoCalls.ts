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
  'Live video calls are not available in this build yet. Please use chat or bookings for now.';
