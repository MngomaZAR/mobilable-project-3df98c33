-- Booking operational integrity fixes.
-- Reconciles live schema drift and ensures confirmed bookings have chat,
-- contract, KYC, review, and payment guardrails.

-- -----------------------------
-- KYC document shape used by app/admin flows
-- -----------------------------
ALTER TABLE public.kyc_documents
  ADD COLUMN IF NOT EXISTS doc_type text,
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS document_type text,
  ADD COLUMN IF NOT EXISTS file_url text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

UPDATE public.kyc_documents
SET
  doc_type = COALESCE(doc_type, document_type),
  document_type = COALESCE(document_type, doc_type),
  storage_path = COALESCE(storage_path, file_url)
WHERE doc_type IS NULL
   OR document_type IS NULL
   OR storage_path IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS kyc_documents_user_doc_type_uidx
  ON public.kyc_documents (user_id, doc_type)
  WHERE doc_type IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS kyc_documents_user_doc_type_upsert_uidx
  ON public.kyc_documents (user_id, doc_type);

CREATE OR REPLACE FUNCTION public.sync_kyc_document_aliases()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.doc_type := COALESCE(NEW.doc_type, NEW.document_type);
  NEW.document_type := COALESCE(NEW.document_type, NEW.doc_type);
  NEW.storage_path := COALESCE(NEW.storage_path, NEW.file_url);
  NEW.file_url := COALESCE(NEW.file_url, NEW.storage_path);
  NEW.status := COALESCE(NEW.status, 'pending');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_kyc_document_aliases ON public.kyc_documents;
CREATE TRIGGER trg_sync_kyc_document_aliases
  BEFORE INSERT OR UPDATE ON public.kyc_documents
  FOR EACH ROW EXECUTE FUNCTION public.sync_kyc_document_aliases();

-- -----------------------------
-- Contracts: reconcile legacy live columns with app columns
-- -----------------------------
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS body text,
  ADD COLUMN IF NOT EXISTS photographer_id uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS creator_id uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS contract_type text,
  ADD COLUMN IF NOT EXISTS content text,
  ADD COLUMN IF NOT EXISTS creator_signature text,
  ADD COLUMN IF NOT EXISTS client_signature text,
  ADD COLUMN IF NOT EXISTS model_signature text,
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS signed_by_photographer boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS signed_by_client boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS signed_by_model boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS photographer_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS model_signed_at timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = 'photographer_id'
  ) THEN
    UPDATE public.contracts
    SET creator_id = COALESCE(creator_id, photographer_id)
    WHERE creator_id IS NULL;
  END IF;

  UPDATE public.contracts
  SET photographer_id = COALESCE(photographer_id, creator_id)
  WHERE photographer_id IS NULL;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = 'body'
  ) THEN
    UPDATE public.contracts
    SET content = COALESCE(content, body)
    WHERE content IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = 'title'
  ) THEN
    UPDATE public.contracts
    SET contract_type = COALESCE(
      contract_type,
      CASE
        WHEN lower(COALESCE(title, '')) LIKE '%model%release%' THEN 'model_release'
        ELSE 'shoot_agreement'
      END
    )
    WHERE contract_type IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = 'signed_by_photographer'
  ) THEN
    UPDATE public.contracts
    SET creator_signature = COALESCE(creator_signature, CASE WHEN signed_by_photographer THEN 'Signed in app' END)
    WHERE creator_signature IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = 'signed_by_client'
  ) THEN
    UPDATE public.contracts
    SET client_signature = COALESCE(client_signature, CASE WHEN signed_by_client THEN 'Signed in app' END)
    WHERE client_signature IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = 'signed_by_model'
  ) THEN
    UPDATE public.contracts
    SET model_signature = COALESCE(model_signature, CASE WHEN signed_by_model THEN 'Signed in app' END)
    WHERE model_signature IS NULL;
  END IF;
END $$;

UPDATE public.contracts
SET
  contract_type = COALESCE(contract_type, 'shoot_agreement'),
  content = COALESCE(content, 'Papzii booking agreement.'),
  status = COALESCE(status, 'draft')
WHERE contract_type IS NULL
   OR content IS NULL
   OR status IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = 'title'
  ) THEN
    ALTER TABLE public.contracts ALTER COLUMN title DROP NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = 'body'
  ) THEN
    ALTER TABLE public.contracts ALTER COLUMN body DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contracts_contract_type_check'
      AND conrelid = 'public.contracts'::regclass
  ) THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_contract_type_check
      CHECK (contract_type IN ('model_release', 'shoot_agreement'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS contracts_booking_contract_type_uidx
  ON public.contracts (booking_id, contract_type)
  WHERE contract_type IS NOT NULL;

-- -----------------------------
-- Booking automation: conversation + contract records
-- -----------------------------
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_booking_id_uidx
  ON public.conversations (booking_id)
  WHERE booking_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversation_participants_conversation_user_uidx
  ON public.conversation_participants (conversation_id, user_id);

CREATE OR REPLACE FUNCTION public.ensure_booking_conversation_and_contracts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
  v_creator_id uuid;
  v_created_by uuid;
  v_title text;
  v_now timestamptz := now();
  v_model_release text := 'Papzii model release for the booked session. Parties agree to the in-app booking terms, usage rights, safety rules, and South African governing law.';
  v_shoot_agreement text := 'Papzii shoot agreement for the booked session. Parties agree to scope, payment, cancellation, conduct, delivery, and dispute terms recorded in the app.';
BEGIN
  IF NEW.status NOT IN ('accepted', 'completed', 'paid_out') THEN
    RETURN NEW;
  END IF;

  v_creator_id := COALESCE(NEW.photographer_id, NEW.model_id);
  v_created_by := COALESCE(NEW.client_id, v_creator_id);

  IF NEW.client_id IS NULL OR v_creator_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_conversation_id
  FROM public.conversations
  WHERE booking_id = NEW.id
  LIMIT 1;

  IF v_conversation_id IS NULL THEN
    v_title := 'Booking chat';

    INSERT INTO public.conversations (title, created_by, booking_id, last_message, last_message_at)
    VALUES (v_title, v_created_by, NEW.id, 'Booking chat opened', v_now)
    RETURNING id INTO v_conversation_id;
  END IF;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  SELECT v_conversation_id, participant_id
  FROM (
    VALUES (NEW.client_id), (NEW.photographer_id), (NEW.model_id)
  ) AS participants(participant_id)
  WHERE participant_id IS NOT NULL
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  INSERT INTO public.contracts (
    booking_id,
    photographer_id,
    creator_id,
    client_id,
    model_id,
    contract_type,
    content,
    status,
    title,
    body
  )
  SELECT
    NEW.id,
    v_creator_id,
    v_creator_id,
    NEW.client_id,
    NEW.model_id,
    'shoot_agreement',
    v_shoot_agreement,
    'draft',
    'Shoot Agreement',
    v_shoot_agreement
  WHERE NOT EXISTS (
    SELECT 1 FROM public.contracts c
    WHERE c.booking_id = NEW.id AND c.contract_type = 'shoot_agreement'
  );

  INSERT INTO public.contracts (
    booking_id,
    photographer_id,
    creator_id,
    client_id,
    model_id,
    contract_type,
    content,
    status,
    title,
    body
  )
  SELECT
    NEW.id,
    v_creator_id,
    v_creator_id,
    NEW.client_id,
    NEW.model_id,
    'model_release',
    v_model_release,
    'draft',
    'Model Release',
    v_model_release
  WHERE NOT EXISTS (
    SELECT 1 FROM public.contracts c
    WHERE c.booking_id = NEW.id AND c.contract_type = 'model_release'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_booking_operational_integrity ON public.bookings;
CREATE TRIGGER trg_booking_operational_integrity
  AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.ensure_booking_conversation_and_contracts();

-- Historical backfill is intentionally omitted here because the live database
-- has drifted on contract constraints. The trigger above protects future writes,
-- and the backfill can be replayed safely after the live contract schema is
-- inspected and normalized.

-- Creator-library media can exist before it is attached to a booking.
ALTER TABLE public.media_assets
  ALTER COLUMN booking_id DROP NOT NULL;

-- -----------------------------
-- FK hardening requested by audit
-- -----------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_customer_id_profiles_fkey'
      AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_customer_id_profiles_fkey
      FOREIGN KEY (customer_id) REFERENCES public.profiles(id) ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reviews_booking_id_bookings_fkey'
      AND conrelid = 'public.reviews'::regclass
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_booking_id_bookings_fkey
      FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reviews_client_id_profiles_fkey'
      AND conrelid = 'public.reviews'::regclass
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_client_id_profiles_fkey
      FOREIGN KEY (client_id) REFERENCES public.profiles(id) ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reviews_photographer_id_profiles_fkey'
      AND conrelid = 'public.reviews'::regclass
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_photographer_id_profiles_fkey
      FOREIGN KEY (photographer_id) REFERENCES public.profiles(id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
