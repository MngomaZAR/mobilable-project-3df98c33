-- Bootstrap profile rows when a new auth user is created.
-- This keeps signup from failing if downstream profile writes are delayed or partially unavailable.

CREATE SCHEMA IF NOT EXISTS app_private;

CREATE OR REPLACE FUNCTION app_private.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_private, public
AS $$
DECLARE
  v_role text := COALESCE(NEW.raw_user_meta_data->>'role', 'client');
  v_full_name text := NULLIF(COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'display_name', NEW.email, ''), '');
  v_city text := NULLIF(NEW.raw_user_meta_data->>'city', '');
  v_phone text := NULLIF(NEW.raw_user_meta_data->>'phone', '');
  v_gender text := NULLIF(NEW.raw_user_meta_data->>'gender', '');
  v_dob date := NULLIF(NEW.raw_user_meta_data->>'date_of_birth', '')::date;
  v_age_verified boolean := COALESCE((NEW.raw_user_meta_data->>'age_verified')::boolean, v_dob IS NOT NULL);
BEGIN
  INSERT INTO public.profiles (
    id,
    role,
    verified,
    full_name,
    city,
    phone,
    date_of_birth,
    age_verified,
    age_verified_at,
    contact_details,
    availability_status,
    avatar_url
  )
  VALUES (
    NEW.id,
    v_role,
    false,
    v_full_name,
    v_city,
    v_phone,
    v_dob,
    v_age_verified,
    CASE WHEN v_age_verified THEN NOW() ELSE NULL END,
    jsonb_build_object('gender', v_gender),
    CASE WHEN v_role IN ('photographer', 'model') THEN 'offline' ELSE NULL END,
    NULL
  )
  ON CONFLICT (id) DO UPDATE
    SET role = EXCLUDED.role,
        full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
        city = COALESCE(EXCLUDED.city, public.profiles.city),
        phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
        date_of_birth = COALESCE(EXCLUDED.date_of_birth, public.profiles.date_of_birth),
        age_verified = COALESCE(public.profiles.age_verified, EXCLUDED.age_verified),
        age_verified_at = COALESCE(public.profiles.age_verified_at, EXCLUDED.age_verified_at),
        contact_details = COALESCE(public.profiles.contact_details, EXCLUDED.contact_details),
        availability_status = COALESCE(public.profiles.availability_status, EXCLUDED.availability_status);

  IF v_role = 'photographer' THEN
    INSERT INTO public.photographers (
      id,
      rating,
      location,
      price_range,
      style,
      bio,
      tags,
      name
    )
    VALUES (
      NEW.id,
      5,
      '',
      '',
      '',
      '',
      ARRAY[]::text[],
      v_full_name
    )
    ON CONFLICT (id) DO UPDATE
      SET name = COALESCE(EXCLUDED.name, public.photographers.name);
  END IF;

  IF v_role = 'model' THEN
    INSERT INTO public.models (
      id,
      rating,
      location,
      price_range,
      style,
      bio,
      tags,
      portfolio_urls
    )
    VALUES (
      NEW.id,
      5,
      '',
      '',
      '',
      '',
      ARRAY[]::text[],
      ARRAY[]::text[]
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_handle_new_user ON auth.users;
CREATE TRIGGER trg_handle_new_user
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION app_private.handle_new_user();
