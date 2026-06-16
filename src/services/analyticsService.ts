import { track } from '../utils/analytics';

export type AnalyticsEvent = 
  | 'session_start'
  | 'booking_initiated'
  | 'booking_completed'
  | 'message_sent'
  | 'media_uploaded'
  | 'tip_sent'
  | 'subscription_started'
  | 'profile_view'
  | 'booking_accepted'
  | 'booking_declined';

export const trackEvent = async (event: AnalyticsEvent, metadata: Record<string, any> = {}) => {
  try {
    const { screen, ...properties } = metadata ?? {};
    await track(event, properties, typeof screen === 'string' ? screen : undefined);
  } catch (err) {
    // Analytics should never crash the main thread
    console.error('Analytics error:', err);
  }
};
