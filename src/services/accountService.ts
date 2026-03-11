import { supabase } from '../config/supabaseClient';

export const requestAccountDeletion = async (reason: string = '') => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('account_deletion_requests')
    .insert({
      created_by: user.id,
      reason,
      status: 'open'
    });

  if (error) throw error;
  return true;
};
