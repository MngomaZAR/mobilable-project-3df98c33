import { supabase } from '../config/supabaseClient';

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
    const { data: { user } } = await supabase.auth.getUser();
    
    // In a real Meta-scale app, this would go to a specialized stream like Kinesis or Kafka.
    // Here we use Supabase as the sink.
    const { error } = await supabase
      .from('analytics_events')
      .insert({
        name: event,          // DB column is 'name', NOT 'event_name'
        created_by: user?.id || null,
        metadata,
        created_at: new Date().toISOString()
      });

    if (error) console.warn('Analytics capture failed:', error.message);
  } catch (err) {
    // Analytics should never crash the main thread
    console.error('Analytics error:', err);
  }
};
