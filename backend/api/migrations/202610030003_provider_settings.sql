-- Keep provider settings compatible with the mobile arrays and upsert keys.
CREATE FUNCTION pg_temp.papzi_equipment_array(value text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE parsed jsonb;
BEGIN
    IF value IS NULL OR btrim(value) = '' THEN RETURN '[]'::jsonb; END IF;
    BEGIN
        parsed := value::jsonb;
    EXCEPTION WHEN invalid_text_representation THEN
        RETURN jsonb_build_array(value);
    END;
    IF jsonb_typeof(parsed) = 'array' THEN RETURN parsed; END IF;
    RETURN jsonb_build_array(value);
END;
$$;

ALTER TABLE photographer_equipment ALTER COLUMN lenses TYPE jsonb
    USING pg_temp.papzi_equipment_array(lenses::text);
ALTER TABLE photographer_equipment ALTER COLUMN extras TYPE jsonb
    USING pg_temp.papzi_equipment_array(extras::text);
CREATE UNIQUE INDEX IF NOT EXISTS photographer_equipment_owner_idx
    ON photographer_equipment (photographer_id);

CREATE OR REPLACE FUNCTION sync_photographer_equipment_tier() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE photographers SET tier_id = NEW.tier_id, updated_at = now()
        WHERE id::text = NEW.photographer_id::text;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS photographer_equipment_tier_sync ON photographer_equipment;
CREATE TRIGGER photographer_equipment_tier_sync
    AFTER INSERT OR UPDATE OF tier_id ON photographer_equipment
    FOR EACH ROW EXECUTE FUNCTION sync_photographer_equipment_tier();

ALTER TABLE model_services ADD COLUMN IF NOT EXISTS requires_age_verification boolean NOT NULL DEFAULT false;
