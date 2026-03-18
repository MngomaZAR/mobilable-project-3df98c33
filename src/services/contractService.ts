import { supabase } from '../config/supabaseClient';
import { LEGAL_CONTENT } from '../constants/LegalContent';

export interface Contract {
  id: string;
  booking_id: string;
  creator_id: string;
  client_id: string;
  model_id?: string | null;
  status: 'draft' | 'signed' | 'expired';
  contract_type: 'model_release' | 'shoot_agreement';
  content: string;
  creator_signature?: string | null;
  client_signature?: string | null;
  model_signature?: string | null;
  signed_at?: string | null;
  created_at: string;
}

const CONTRACT_TEMPLATES: Record<'model_release' | 'shoot_agreement', string> = {
  model_release: LEGAL_CONTENT.MODEL_RELEASE,
  shoot_agreement: `# Papzii Shoot Agreement
**Last Updated: March 2026 - South African Law**

This agreement governs a booked shoot between Client, Photographer, and where applicable Model.

## Scope
- Session details are defined by booking package, schedule, and in-app notes.
- Parties must arrive on time and act professionally.

## Payment and Escrow
- Payment is processed in-app and held/settled per Papzii terms.
- Off-platform payment circumvention is prohibited.

## Cancellation and No-show
- Cancellation windows and penalties follow Papzii Terms.
- No-shows may trigger penalties and platform enforcement.

## Conduct and Safety
- Harassment, coercion, or illegal conduct is prohibited.
- Parties must use in-app reporting for disputes or safety concerns.

## Usage and Rights
- Creative usage rights are governed by the model release and booking terms.
- Additional commercial usage requires explicit consent where applicable.

## Governing Law
Republic of South Africa.
`,
};

export const fetchBookingContracts = async (bookingId: string) => {
  const { data, error } = await supabase
    .from('contracts')
    .select('*')
    .eq('booking_id', bookingId);
    
  if (error) {
    console.error('fetchBookingContracts error:', error);
    throw error;
  }
  return data as Contract[];
};

export const createContract = async (bookingId: string, type: 'model_release' | 'shoot_agreement', content: string) => {
  // Fetch booking details to get participants
  const { data: booking, error: bError } = await supabase
    .from('bookings')
    .select('photographer_id, client_id, model_id')
    .eq('id', bookingId)
    .single();
    
  if (bError) throw bError;

  const { data, error } = await supabase
    .from('contracts')
    .insert({
      booking_id: bookingId,
      creator_id: booking.photographer_id,
      client_id: booking.client_id,
      model_id: booking.model_id,
      contract_type: type,
      content,
      status: 'draft'
    })
    .select()
    .single();

  if (error) throw error;
  return data as Contract;
};

export const ensureBookingContracts = async (bookingId: string): Promise<Contract[]> => {
  const existing = await fetchBookingContracts(bookingId);
  const have = new Set(existing.map((c) => c.contract_type));

  const missing: Array<'model_release' | 'shoot_agreement'> = [];
  if (!have.has('model_release')) missing.push('model_release');
  if (!have.has('shoot_agreement')) missing.push('shoot_agreement');

  if (missing.length === 0) return existing;

  const created: Contract[] = [];
  for (const type of missing) {
    try {
      const content = CONTRACT_TEMPLATES[type];
      const contract = await createContract(bookingId, type, content);
      created.push(contract);
    } catch (error) {
      // Non-fatal: if policy prevents creation for this role, caller still gets existing docs.
      console.warn(`ensureBookingContracts: failed to create ${type}`, error);
    }
  }

  if (created.length === 0) return existing;
  return [...existing, ...created];
};

export const signContract = async (contractId: string, signature: string, role: 'creator' | 'client' | 'model') => {
  const { data: existing, error: fetchError } = await supabase
    .from('contracts')
    .select('id, client_id, model_id, creator_signature, client_signature, model_signature')
    .eq('id', contractId)
    .single();

  if (fetchError) throw fetchError;

  const nextCreatorSignature = role === 'creator' ? signature : existing.creator_signature;
  const nextClientSignature = role === 'client' ? signature : existing.client_signature;
  const nextModelSignature = role === 'model' ? signature : existing.model_signature;

  // Base required signers are creator + client.
  // If model is a distinct participant, require model signature as well.
  const requiresModelSignature = Boolean(existing.model_id) && existing.model_id !== existing.client_id;
  const fullySigned = Boolean(nextCreatorSignature && nextClientSignature && (!requiresModelSignature || nextModelSignature));

  const update: any = {
    creator_signature: nextCreatorSignature,
    client_signature: nextClientSignature,
    model_signature: nextModelSignature,
    status: fullySigned ? 'signed' : 'draft',
    signed_at: fullySigned ? new Date().toISOString() : null,
  };

  const { error } = await supabase
    .from('contracts')
    .update(update)
    .eq('id', contractId);

  if (error) throw error;
};
