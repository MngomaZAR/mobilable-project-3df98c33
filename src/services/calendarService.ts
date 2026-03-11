import { supabase } from '../config/supabaseClient';

export interface Availability {
  id: string;
  user_id: string;
  day_of_week: number; // 0-6
  start_time: string; // HH:mm
  end_time: string;   // HH:mm
  is_available: boolean;
}

export interface BlockedDate {
  id: string;
  user_id: string;
  blocked_date: string; // YYYY-MM-DD
  reason?: string;
}

export const fetchAvailability = async (userId: string) => {
  const { data, error } = await supabase
    .from('availability')
    .select('*')
    .eq('user_id', userId);
    
  if (error) throw error;
  return data as Availability[];
};

export const updateAvailability = async (userId: string, slots: Partial<Availability>[]) => {
  // Simple implementation: upsert based on user_id and day_of_week
  // Assumes a unique constraint on (user_id, day_of_week)
  const { error } = await supabase
    .from('availability')
    .upsert(slots.map(s => ({ ...s, user_id: userId })));
    
  if (error) throw error;
};

export const fetchBlockedDates = async (userId: string) => {
  const { data, error } = await supabase
    .from('blocked_dates')
    .select('*')
    .eq('user_id', userId);
    
  if (error) throw error;
  return data as BlockedDate[];
};

export const toggleBlockedDate = async (userId: string, date: string, isBlocked: boolean) => {
  if (isBlocked) {
    const { error } = await supabase
      .from('blocked_dates')
      .insert({ user_id: userId, blocked_date: date });
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('blocked_dates')
      .delete()
      .match({ user_id: userId, blocked_date: date });
    if (error) throw error;
  }
};
