-- New bookings retain their authoritative offer even after creator settings change.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS model_service_type text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS photography_service_type text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS equipment_selection jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pricing_snapshot jsonb;

-- Historical records have no reconstructed snapshot: their original amounts remain intact.
ALTER TABLE bookings ADD CONSTRAINT bookings_model_service_type_allowed
    CHECK (model_service_type IS NULL OR model_service_type IN
        ('brand_ambassador','product_shoot','event_hosting','social_promo','fashion_shoot','music_video','film_extra'));
ALTER TABLE bookings ADD CONSTRAINT bookings_pricing_snapshot_object
    CHECK (pricing_snapshot IS NULL OR jsonb_typeof(pricing_snapshot) = 'object');
