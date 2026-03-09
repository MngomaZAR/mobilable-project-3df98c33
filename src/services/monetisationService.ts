import { supabase } from '../config/supabaseClient';
import { Earning, Subscription, Tip } from '../types';
import { Result, success, failure } from '../utils/result';

export const fetchCreatorEarnings = async (userId: string): Promise<Earning[]> => {
  try {
    const { data, error } = await supabase
      .from('earnings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err: any) {
    if (err.message?.includes('relation "earnings" does not exist')) {
       return [];
    }
    throw err;
  }
};

export const sendTip = async (receiverId: string, amount: number, message: string = ''): Promise<Result<Tip>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return failure(new Error("Not authenticated"));

  // Assertion: Ensure positive amount
  if (amount <= 0) return failure(new Error("Tip amount must be positive"));

  try {
    const { data, error } = await supabase
      .from('tips')
      .insert({
        sender_id: user.id,
        receiver_id: receiverId,
        amount,
        message
      })
      .select()
      .single();

    if (error) throw error;
    return success(data);
  } catch (err: any) {
    return failure(err);
  }
};

export const subscribeToCreator = async (creatorId: string, tierId: string): Promise<Result<Subscription>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return failure(new Error("Not authenticated"));

  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .insert({
        subscriber_id: user.id,
        creator_id: creatorId,
        tier_id: tierId,
        status: 'active',
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    return success(data);
  } catch (err: any) {
    return failure(err);
  }
};
