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
    if (err.message?.includes('relation "earnings" does not exist')) return [];
    throw err;
  }
};

/**
 * Send a tip via a direct DB insert.
 * The DB trigger (handle_tip_earnings) automatically creates an earnings row.
 * Payment for the tip is handled by PayFast — this records the intent.
 */
export const sendTip = async (
  receiverId: string,
  amount: number,
  message: string = ''
): Promise<Result<Tip>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return failure(new Error('Not authenticated'));
  if (amount <= 0) return failure(new Error('Tip amount must be positive'));
  if (amount < 5) return failure(new Error('Minimum tip is R5'));

  try {
    const { data, error } = await supabase
      .from('tips')
      .insert({
        sender_id: user.id,
        receiver_id: receiverId,
        amount,
        message: message.trim() || null,
        status: 'pending', // PayFast ITN will mark as completed
      })
      .select()
      .single();

    if (error) throw error;
    return success(data as Tip);
  } catch (err: any) {
    return failure(err);
  }
};

/**
 * Create a PayFast checkout link for a tip payment.
 * Uses the payfast-handler edge function.
 */
export const createTipCheckoutLink = async (params: {
  receiverId: string;
  amount: number;
  message?: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
}): Promise<{ paymentUrl: string; tipId: string }> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // First record the tip as pending
  const { data: tip, error: tipError } = await supabase
    .from('tips')
    .insert({
      sender_id: user.id,
      receiver_id: params.receiverId,
      amount: params.amount,
      message: params.message?.trim() || null,
      status: 'pending',
    })
    .select()
    .single();

  if (tipError) throw tipError;

  // Create PayFast checkout via edge function
  const { data, error } = await supabase.functions.invoke('payfast-handler', {
    body: {
      tip_id: tip.id,
      amount: params.amount,
      item_name: `Tip for creator`,
      return_url: params.returnUrl,
      cancel_url: params.cancelUrl,
      notify_url: params.notifyUrl,
    },
  });

  if (error) throw new Error(error.message || 'Unable to create tip payment.');
  if (!data?.paymentUrl) throw new Error('No payment URL returned.');

  return { paymentUrl: data.paymentUrl, tipId: tip.id };
};

export const subscribeToCreator = async (
  creatorId: string,
  tierId: string
): Promise<Result<Subscription>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return failure(new Error('Not authenticated'));

  try {
    // Check for existing active subscription
    const { data: existing } = await supabase
      .from('subscriptions')
      .select('id, status')
      .eq('subscriber_id', user.id)
      .eq('creator_id', creatorId)
      .eq('status', 'active')
      .maybeSingle();

    if (existing) return failure(new Error('You already have an active subscription to this creator.'));

    const { data, error } = await supabase
      .from('subscriptions')
      .insert({
        subscriber_id: user.id,
        creator_id: creatorId,
        tier_id: tierId,
        status: 'active',
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return success(data as Subscription);
  } catch (err: any) {
    return failure(err);
  }
};

export const cancelSubscription = async (subscriptionId: string): Promise<Result<void>> => {
  try {
    const { error } = await supabase
      .from('subscriptions')
      .update({ status: 'cancelled' })
      .eq('id', subscriptionId);
    if (error) throw error;
    return success(undefined);
  } catch (err: any) {
    return failure(err);
  }
};
