import { supabase } from '../config/supabaseClient';
import { requireCurrentAuthenticatedUser } from '../config/currentUser';

export interface SupportTicketPayload {
  subject: string;
  category: 'general' | 'billing' | 'safety' | 'technical' | 'account';
  description: string;
}

export interface SupportTicketRow {
  id: string;
  created_by: string;
  subject: string;
  category: string;
  description: string;
  status: string;
  created_at: string;
}

/** Submit a support ticket to the support_tickets table */
export const submitSupportTicket = async (payload: SupportTicketPayload): Promise<SupportTicketRow> => {
  const user = await requireCurrentAuthenticatedUser();

  const { data, error } = await supabase
    .from('support_tickets')
    .insert({
      created_by: user.id,
      subject: payload.subject,
      category: payload.category,
      description: payload.description,
      status: 'open',
    })
    .select()
    .single();

  if (error) throw new Error(error.message || 'Failed to submit support ticket.');
  return data as SupportTicketRow;
};

/** Fetch current user's open support tickets */
export const fetchMyTickets = async (): Promise<SupportTicketRow[]> => {
  const user = await requireCurrentAuthenticatedUser().catch(() => null);
  if (!user) return [];

  const { data, error } = await supabase
    .from('support_tickets')
    .select('*')
    .eq('created_by', user.id)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message || 'Failed to load tickets.');
  return (data ?? []) as SupportTicketRow[];
};
