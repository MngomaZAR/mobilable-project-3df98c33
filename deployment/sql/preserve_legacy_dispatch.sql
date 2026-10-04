-- A pre-migration compatibility step for the pre-ledger September deployment.
-- Preserve expired, unauthenticated offers; never reinterpret them as new offers.
DO $$
DECLARE legacy_columns text[];
BEGIN
    IF to_regclass('public.dispatch_offers') IS NULL THEN RETURN; END IF;
    SELECT array_agg(column_name ORDER BY column_name) INTO legacy_columns
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name='dispatch_offers';
    IF 'pricing_snapshot'=ANY(legacy_columns) AND 'offer_rank'=ANY(legacy_columns) THEN
        RETURN;
    END IF;
    IF legacy_columns IS DISTINCT FROM ARRAY[
        'created_at','dispatch_request_id','expires_at','id','provider_id','status','updated_at'
    ]::text[] THEN
        RAISE EXCEPTION 'Unknown legacy dispatch schema: migration requires review';
    END IF;
    IF EXISTS (SELECT 1 FROM public.dispatch_offers
        WHERE expires_at IS NULL OR expires_at>clock_timestamp()
        OR status IS NULL OR status NOT IN ('offered','expired','declined','cancelled')) THEN
        RAISE EXCEPTION 'Active or unresolved legacy dispatch offers must be reconciled before release';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE confrelid='public.dispatch_offers'::regclass) THEN
        RAISE EXCEPTION 'Legacy dispatch references require explicit migration';
    END IF;
    IF to_regclass('papzii_legacy.dispatch_offers') IS NOT NULL THEN
        RAISE EXCEPTION 'An existing legacy archive must not be overwritten';
    END IF;
    CREATE SCHEMA IF NOT EXISTS papzii_legacy;
    REVOKE ALL ON SCHEMA papzii_legacy FROM PUBLIC;
    ALTER TABLE public.dispatch_offers SET SCHEMA papzii_legacy;
    REVOKE ALL ON papzii_legacy.dispatch_offers FROM PUBLIC;
END;
$$;
