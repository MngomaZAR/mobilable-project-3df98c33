import { supabase } from '../config/supabaseClient';

export type ConsentType = 'terms' | 'privacy' | 'marketing';

export interface ConsentPayload {
  type: ConsentType;
  version: string;
  accepted: boolean;
}

/** Record user consent for POPIA/GDPR compliance */
export const recordConsent = async (payload: ConsentPayload): Promise<void> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be logged in to record consent.');

  const { error } = await supabase.from('user_consents').insert({
    user_id: user.id,
    consent_type: payload.type,
    version: payload.version,
    accepted: payload.accepted,
    accepted_at: new Date().toISOString(),
    metadata: { user_agent: 'papzi-mobile' },
  });

  if (error) throw new Error(error.message || 'Failed to record consent.');
};

/** Record all required consents at once (e.g. on first launch) */
export const recordInitialConsents = async (marketingOptIn: boolean): Promise<void> => {
  const CURRENT_VERSION = '1.0';
  await Promise.all([
    recordConsent({ type: 'terms', version: CURRENT_VERSION, accepted: true }),
    recordConsent({ type: 'privacy', version: CURRENT_VERSION, accepted: true }),
    recordConsent({ type: 'marketing', version: CURRENT_VERSION, accepted: marketingOptIn }),
  ]);
};
