-- Additive domain schema. Legacy generic dispatch/contracts are not authenticated evidence.
ALTER TABLE dispatch_requests ADD COLUMN IF NOT EXISTS booking_id text REFERENCES bookings(id);
ALTER TABLE dispatch_requests ADD COLUMN IF NOT EXISTS client_id text REFERENCES profiles(id);
ALTER TABLE dispatch_requests ADD COLUMN IF NOT EXISTS service_type text;
ALTER TABLE dispatch_requests ADD COLUMN IF NOT EXISTS fanout_count integer;
ALTER TABLE dispatch_requests ADD COLUMN IF NOT EXISTS intensity_level integer;
ALTER TABLE dispatch_requests ADD COLUMN IF NOT EXISTS sla_timeout_seconds integer;
ALTER TABLE dispatch_requests ADD COLUMN IF NOT EXISTS assignment_profile_id text REFERENCES profiles(id);
ALTER TABLE dispatch_requests ADD COLUMN IF NOT EXISTS quote_token text;
ALTER TABLE dispatch_requests ADD COLUMN IF NOT EXISTS requested_lat double precision;
ALTER TABLE dispatch_requests ADD COLUMN IF NOT EXISTS requested_lng double precision;
ALTER TABLE dispatch_requests ADD COLUMN IF NOT EXISTS price_base numeric(14,2);
ALTER TABLE dispatch_requests ADD COLUMN IF NOT EXISTS price_multiplier numeric(14,2);
ALTER TABLE dispatch_requests ADD COLUMN IF NOT EXISTS price_estimate numeric(14,2);
ALTER TABLE dispatch_requests ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE dispatch_requests ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
ALTER TABLE dispatch_requests ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE dispatch_requests ADD COLUMN IF NOT EXISTS request_fingerprint text;
ALTER TABLE dispatch_requests ADD COLUMN IF NOT EXISTS booking_snapshot jsonb;
ALTER TABLE dispatch_requests ADD CONSTRAINT dispatch_managed_request_valid CHECK (
    request_fingerprint IS NULL OR (
        booking_id IS NOT NULL AND client_id IS NOT NULL AND quote_token IS NOT NULL
        AND service_type IN ('photography','modeling') AND service_type IS NOT NULL
        AND status IN ('queued','offered','accepted','expired','cancelled') AND status IS NOT NULL
        AND fanout_count IS NOT NULL AND fanout_count BETWEEN 1 AND 20
        AND intensity_level IS NOT NULL AND intensity_level BETWEEN 1 AND 5
        AND sla_timeout_seconds IS NOT NULL AND sla_timeout_seconds BETWEEN 15 AND 300
        AND requested_lat IS NOT NULL AND requested_lat BETWEEN -35 AND -22
        AND requested_lng IS NOT NULL AND requested_lng BETWEEN 16 AND 33
        AND price_base IS NOT NULL AND price_estimate IS NOT NULL AND price_multiplier IS NOT NULL
        AND price_base>0 AND price_estimate>0 AND price_estimate<=price_base AND price_multiplier=1
        AND expires_at IS NOT NULL AND idempotency_key IS NOT NULL
        AND booking_snapshot IS NOT NULL AND jsonb_typeof(booking_snapshot)='object'
    )
) NOT VALID;
CREATE UNIQUE INDEX dispatch_booking_unique ON dispatch_requests(booking_id) WHERE request_fingerprint IS NOT NULL;
CREATE UNIQUE INDEX dispatch_request_key_unique ON dispatch_requests(client_id,idempotency_key) WHERE request_fingerprint IS NOT NULL;
CREATE INDEX dispatch_request_expiry_idx ON dispatch_requests(expires_at) WHERE status IN ('queued','offered');

CREATE TABLE dispatch_offers (
    id text PRIMARY KEY,
    dispatch_request_id text NOT NULL REFERENCES dispatch_requests(id),
    provider_id text NOT NULL REFERENCES profiles(id),
    offer_rank integer NOT NULL CHECK (offer_rank BETWEEN 1 AND 20),
    status text NOT NULL CHECK (status IN ('offered','accepted','declined','expired','cancelled')),
    expires_at timestamptz NOT NULL,
    pricing_snapshot jsonb NOT NULL CHECK (jsonb_typeof(pricing_snapshot)='object'),
    idempotency_key text,
    responded_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(dispatch_request_id,provider_id),
    UNIQUE(dispatch_request_id,offer_rank)
);
CREATE UNIQUE INDEX dispatch_one_winner ON dispatch_offers(dispatch_request_id) WHERE status='accepted';
CREATE UNIQUE INDEX dispatch_response_key_unique ON dispatch_offers(provider_id,idempotency_key) WHERE responded_at IS NOT NULL;
CREATE INDEX dispatch_provider_offers_idx ON dispatch_offers(provider_id,created_at DESC);
CREATE FUNCTION dispatch_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME='dispatch_offers' THEN
        IF (to_jsonb(NEW)-ARRAY['status','responded_at','idempotency_key']) IS DISTINCT FROM
           (to_jsonb(OLD)-ARRAY['status','responded_at','idempotency_key'])
           OR (OLD.status<>'offered' AND NEW.status IS DISTINCT FROM OLD.status)
           OR (OLD.responded_at IS NOT NULL AND ROW(NEW.responded_at,NEW.idempotency_key) IS DISTINCT FROM ROW(OLD.responded_at,OLD.idempotency_key)) THEN
            RAISE EXCEPTION 'Dispatch offer identity, quote and response are immutable' USING ERRCODE='23514';
        END IF;
    ELSIF OLD.request_fingerprint IS NOT NULL THEN
        IF (to_jsonb(NEW)-ARRAY['status','assignment_profile_id','accepted_at','price_estimate','updated_at','expires_at']) IS DISTINCT FROM
           (to_jsonb(OLD)-ARRAY['status','assignment_profile_id','accepted_at','price_estimate','updated_at','expires_at'])
           OR NEW.expires_at>OLD.expires_at
           OR (OLD.status IN ('accepted','expired','cancelled') AND NEW.status IS DISTINCT FROM OLD.status)
           OR (OLD.assignment_profile_id IS NOT NULL AND ROW(NEW.assignment_profile_id,NEW.accepted_at,NEW.price_estimate) IS DISTINCT FROM ROW(OLD.assignment_profile_id,OLD.accepted_at,OLD.price_estimate)) THEN
            RAISE EXCEPTION 'Dispatch request identity, ceiling and winner are immutable' USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER dispatch_offer_snapshot_immutable BEFORE UPDATE ON dispatch_offers
    FOR EACH ROW EXECUTE FUNCTION dispatch_snapshot_immutable();
CREATE TRIGGER dispatch_request_snapshot_immutable BEFORE UPDATE ON dispatch_requests
    FOR EACH ROW EXECUTE FUNCTION dispatch_snapshot_immutable();
CREATE INDEX dispatch_private_current_fix_idx ON location_tracks(user_id,role,created_at DESC,id DESC)
    WHERE booking_id IS NULL AND source='app';
CREATE TABLE dispatch_events (
    id text PRIMARY KEY,
    dispatch_request_id text NOT NULL REFERENCES dispatch_requests(id),
    booking_id text NOT NULL REFERENCES bookings(id),
    actor_id text NOT NULL REFERENCES profiles(id),
    event_type text NOT NULL,
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dispatch_event_request_idx ON dispatch_events(dispatch_request_id,created_at,id);

CREATE FUNCTION dispatch_booking_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.dispatch_request_id IS NOT NULL AND (
        NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.photographer_id IS DISTINCT FROM OLD.photographer_id OR NEW.model_id IS DISTINCT FROM OLD.model_id
        OR NEW.pricing_snapshot IS DISTINCT FROM OLD.pricing_snapshot
        OR NEW.quote_amount IS DISTINCT FROM OLD.quote_amount
        OR ROW(NEW.price_total,NEW.total_amount,NEW.commission_amount,NEW.photographer_payout,NEW.payout_amount)
           IS DISTINCT FROM ROW(OLD.price_total,OLD.total_amount,OLD.commission_amount,OLD.photographer_payout,OLD.payout_amount)
        OR (NEW.status='accepted' AND OLD.status IS DISTINCT FROM 'accepted')
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM dispatch_requests r JOIN dispatch_offers o ON o.dispatch_request_id=r.id
            WHERE r.id=OLD.dispatch_request_id AND r.booking_id=NEW.id AND r.client_id=NEW.client_id
            AND r.status='accepted' AND o.provider_id=r.assignment_profile_id
            AND o.status IN ('offered','accepted')
            AND r.assignment_profile_id=coalesce(NEW.photographer_id,NEW.model_id)
            AND NEW.assignment_state='accepted' AND NEW.pricing_snapshot=o.pricing_snapshot
            AND NEW.quote_amount=(o.pricing_snapshot->>'total_amount')::numeric
            AND NEW.price_total=NEW.quote_amount AND NEW.total_amount=NEW.quote_amount
            AND NEW.commission_amount=(o.pricing_snapshot->>'commission_amount')::numeric
            AND NEW.payout_amount=(o.pricing_snapshot->>'payout_amount')::numeric
            AND NEW.photographer_payout=NEW.payout_amount
        ) THEN
            RAISE EXCEPTION 'Use the authenticated dispatch offer acceptance command' USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER dispatch_booking_assignment_guard BEFORE UPDATE ON bookings
    FOR EACH ROW EXECUTE FUNCTION dispatch_booking_assignment_guard();

CREATE FUNCTION dispatch_winner_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_request dispatch_requests;
BEGIN
    SELECT * INTO current_request FROM dispatch_requests WHERE id=NEW.id;
    IF current_request.request_fingerprint IS NOT NULL AND current_request.status='accepted' THEN
        IF NOT EXISTS (
            SELECT 1 FROM dispatch_offers o JOIN bookings b ON b.id=current_request.booking_id
            WHERE o.dispatch_request_id=current_request.id AND o.status='accepted'
            AND o.provider_id=current_request.assignment_profile_id AND b.dispatch_request_id=current_request.id
            AND coalesce(b.photographer_id,b.model_id)=o.provider_id AND b.assignment_state='accepted'
            AND b.pricing_snapshot=o.pricing_snapshot AND b.quote_amount=current_request.price_estimate
        ) THEN
            RAISE EXCEPTION 'Dispatch winner, booking and immutable quote must agree' USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER dispatch_winner_consistency AFTER INSERT OR UPDATE ON dispatch_requests
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dispatch_winner_consistency();

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS content_version integer;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS created_by text REFERENCES profiles(id);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE contracts ADD CONSTRAINT contracts_managed_content_valid CHECK (
    content_version IS NULL OR (
        content_version=1 AND content IS NOT NULL AND length(btrim(content)) BETWEEN 1 AND 50000
        AND body IS NOT NULL AND body=content AND content_hash IS NOT NULL
        AND content_hash=encode(digest(convert_to(content,'UTF8'),'sha256'),'hex')
        AND booking_id IS NOT NULL AND creator_id IS NOT NULL AND client_id IS NOT NULL
        AND creator_id<>client_id AND (model_id IS NULL OR model_id<>client_id)
        AND contract_type IN ('model_release','shoot_agreement') AND contract_type IS NOT NULL
        AND status IN ('draft','signed','expired') AND status IS NOT NULL
        AND expires_at IS NOT NULL AND created_by IS NOT NULL
        AND coalesce(created_by IN (client_id,creator_id,model_id),false)
    )
) NOT VALID;
CREATE UNIQUE INDEX contracts_managed_booking_type_unique ON contracts(booking_id,contract_type) WHERE content_version IS NOT NULL;
CREATE TABLE contract_signatures (
    contract_id text NOT NULL REFERENCES contracts(id),
    signer_id text NOT NULL REFERENCES profiles(id),
    signature text NOT NULL CHECK (length(btrim(signature)) BETWEEN 2 AND 200),
    content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    content_version integer NOT NULL CHECK (content_version=1),
    method text NOT NULL CHECK (method='authenticated_typed_acknowledgement'),
    signed_at timestamptz NOT NULL,
    PRIMARY KEY(contract_id,signer_id)
);
CREATE FUNCTION contract_draft_creation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.content_version IS NOT NULL AND (
        NEW.status IS DISTINCT FROM 'draft' OR NEW.client_signature IS NOT NULL OR NEW.creator_signature IS NOT NULL
        OR NEW.model_signature IS NOT NULL OR NEW.signed_at IS NOT NULL OR NEW.client_signed_at IS NOT NULL
        OR NEW.photographer_signed_at IS NOT NULL OR NEW.model_signed_at IS NOT NULL
        OR NEW.signed_by_client IS DISTINCT FROM false OR NEW.signed_by_photographer IS DISTINCT FROM false
        OR NEW.signed_by_model IS DISTINCT FROM false
    ) THEN
        RAISE EXCEPTION 'Authenticated contracts must start as unsigned drafts' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER contract_draft_creation BEFORE INSERT ON contracts
    FOR EACH ROW EXECUTE FUNCTION contract_draft_creation();
CREATE FUNCTION contract_signature_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document contracts;
BEGIN
    IF TG_OP<>'INSERT' THEN
        RAISE EXCEPTION 'Contract acknowledgement evidence is immutable' USING ERRCODE='23514';
    END IF;
    SELECT * INTO document FROM contracts WHERE id=NEW.contract_id;
    IF document.status<>'draft' OR document.expires_at<=clock_timestamp()
        OR NEW.signer_id NOT IN (document.client_id,document.creator_id,coalesce(document.model_id,document.creator_id))
        OR NEW.content_hash IS DISTINCT FROM document.content_hash OR NEW.content_version IS DISTINCT FROM document.content_version THEN
        RAISE EXCEPTION 'Acknowledgement must bind an open document and its party' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER contract_signature_immutable BEFORE INSERT OR UPDATE OR DELETE ON contract_signatures
    FOR EACH ROW EXECUTE FUNCTION contract_signature_immutable();
CREATE FUNCTION contract_content_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.content_version IS NULL THEN
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        IF NEW.content_version IS NOT NULL THEN
            RAISE EXCEPTION 'Legacy signatures cannot be adopted as authenticated evidence' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'Authenticated contract evidence cannot be deleted' USING ERRCODE='23514';
    END IF;
    IF ROW(NEW.booking_id,NEW.creator_id,NEW.photographer_id,NEW.client_id,NEW.model_id,NEW.contract_type,
           NEW.content,NEW.body,NEW.title,NEW.content_hash,NEW.content_version,NEW.created_by,NEW.expires_at,NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.booking_id,OLD.creator_id,OLD.photographer_id,OLD.client_id,OLD.model_id,OLD.contract_type,
           OLD.content,OLD.body,OLD.title,OLD.content_hash,OLD.content_version,OLD.created_by,OLD.expires_at,OLD.created_at)
       OR (OLD.client_signature IS NOT NULL AND NEW.client_signature IS DISTINCT FROM OLD.client_signature)
       OR (OLD.creator_signature IS NOT NULL AND NEW.creator_signature IS DISTINCT FROM OLD.creator_signature)
       OR (OLD.model_signature IS NOT NULL AND NEW.model_signature IS DISTINCT FROM OLD.model_signature)
       OR (OLD.client_signed_at IS NOT NULL AND NEW.client_signed_at IS DISTINCT FROM OLD.client_signed_at)
       OR (OLD.photographer_signed_at IS NOT NULL AND NEW.photographer_signed_at IS DISTINCT FROM OLD.photographer_signed_at)
       OR (OLD.model_signed_at IS NOT NULL AND NEW.model_signed_at IS DISTINCT FROM OLD.model_signed_at)
       OR (OLD.signed_at IS NOT NULL AND NEW.signed_at IS DISTINCT FROM OLD.signed_at)
       OR (OLD.status<>'draft' AND NEW.status IS DISTINCT FROM OLD.status) THEN
        RAISE EXCEPTION 'Contract content, parties and acknowledgements are immutable' USING ERRCODE='23514';
    END IF;
    IF (NEW.client_signature IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contract_signatures WHERE contract_id=NEW.id AND signer_id=NEW.client_id AND signature=NEW.client_signature AND signed_at=NEW.client_signed_at))
       OR (NEW.creator_signature IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contract_signatures WHERE contract_id=NEW.id AND signer_id=NEW.creator_id AND signature=NEW.creator_signature AND signed_at=coalesce(NEW.photographer_signed_at,NEW.model_signed_at)))
       OR (NEW.model_signature IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contract_signatures WHERE contract_id=NEW.id AND signer_id=NEW.model_id AND signature=NEW.model_signature AND signed_at=NEW.model_signed_at))
       OR NEW.signed_by_client IS DISTINCT FROM (NEW.client_signature IS NOT NULL)
       OR NEW.signed_by_photographer IS DISTINCT FROM (NEW.photographer_id IS NOT NULL AND NEW.creator_signature IS NOT NULL)
       OR NEW.signed_by_model IS DISTINCT FROM (NEW.model_signature IS NOT NULL)
       OR (NEW.status='signed' AND (NEW.signed_at IS NULL OR NEW.client_signature IS NULL OR NEW.creator_signature IS NULL OR (NEW.model_id IS NOT NULL AND NEW.model_signature IS NULL))) THEN
        RAISE EXCEPTION 'Signature fields must agree with authenticated acknowledgement evidence' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER contract_content_immutable BEFORE UPDATE OR DELETE ON contracts
    FOR EACH ROW EXECUTE FUNCTION contract_content_immutable();
