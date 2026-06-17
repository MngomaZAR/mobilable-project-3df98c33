-- Align live database columns with app and Edge Function contracts.
-- Additive/idempotent only: these columns are referenced by deployed clients or functions.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS is_instant boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS package_id text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gender text;

UPDATE public.profiles
SET gender = NULLIF(contact_details->>'gender', '')
WHERE gender IS NULL
  AND contact_details ? 'gender';

ALTER TABLE public.models
  ADD COLUMN IF NOT EXISTS is_online boolean DEFAULT false;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reply_preview text,
  ADD COLUMN IF NOT EXISTS audio_url text,
  ADD COLUMN IF NOT EXISTS audio_duration_seconds integer;

CREATE INDEX IF NOT EXISTS idx_messages_read_at ON public.messages(read_at);
CREATE INDEX IF NOT EXISTS idx_messages_deleted_at ON public.messages(deleted_at);

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS reference_type text,
  ADD COLUMN IF NOT EXISTS reference_id uuid;

ALTER TABLE public.notification_events
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS action_type text,
  ADD COLUMN IF NOT EXISTS action_payload jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS icon text,
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

ALTER TABLE public.media_access_logs
  ADD COLUMN IF NOT EXISTS watermarked boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS encrypted boolean DEFAULT false;

ALTER TABLE public.subscription_tiers
  ADD COLUMN IF NOT EXISTS creator_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS price numeric(10, 2),
  ADD COLUMN IF NOT EXISTS perks text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS max_subscribers integer;

UPDATE public.subscription_tiers
SET
  name = COALESCE(name, label),
  price = COALESCE(price, price_zar)
WHERE name IS NULL
   OR price IS NULL;

CREATE INDEX IF NOT EXISTS idx_subscription_tiers_creator_id
  ON public.subscription_tiers(creator_id);

-- Keep the legacy creator_subscription_tiers data visible to the canonical table when present.
INSERT INTO public.subscription_tiers (
  id,
  creator_id,
  name,
  label,
  description,
  price,
  price_zar,
  perks,
  is_active,
  color,
  max_subscribers,
  created_at
)
SELECT
  id,
  creator_id,
  name,
  name,
  description,
  price,
  price,
  COALESCE(perks, '{}'::text[]),
  COALESCE(is_active, true),
  color,
  max_subscribers,
  created_at
FROM public.creator_subscription_tiers
ON CONFLICT (id) DO UPDATE
SET
  creator_id = EXCLUDED.creator_id,
  name = EXCLUDED.name,
  label = COALESCE(public.subscription_tiers.label, EXCLUDED.label),
  description = COALESCE(public.subscription_tiers.description, EXCLUDED.description),
  price = EXCLUDED.price,
  price_zar = COALESCE(public.subscription_tiers.price_zar, EXCLUDED.price_zar),
  perks = EXCLUDED.perks,
  is_active = EXCLUDED.is_active,
  color = EXCLUDED.color,
  max_subscribers = EXCLUDED.max_subscribers;
