-- Hardening Migration: 20260308000000_hardening.sql
-- Goal: Unify profiles, add performance indexes, and harden monetization.

-- 1. Unify Profiles Schema
-- Add talent-specific columns to profiles to create a Single Source of Truth.
DO $$ 
BEGIN 
    -- Column: bio
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'profiles' AND column_name = 'bio') THEN
        ALTER TABLE profiles ADD COLUMN bio TEXT;
    END IF;
    
    -- Column: tags
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'profiles' AND column_name = 'tags') THEN
        ALTER TABLE profiles ADD COLUMN tags TEXT[] DEFAULT '{}';
    END IF;

    -- Column: price_range
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'profiles' AND column_name = 'price_range') THEN
        ALTER TABLE profiles ADD COLUMN price_range TEXT DEFAULT '$$';
    END IF;

    -- Column: location_name (human readable)
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'profiles' AND column_name = 'location_name') THEN
        ALTER TABLE profiles ADD COLUMN location_name TEXT;
    END IF;

    -- Column: portfolio_urls
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'profiles' AND column_name = 'portfolio_urls') THEN
        ALTER TABLE profiles ADD COLUMN portfolio_urls TEXT[] DEFAULT '{}';
    END IF;

    -- Column: rating
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'profiles' AND column_name = 'rating') THEN
        ALTER TABLE profiles ADD COLUMN rating NUMERIC(3, 2) DEFAULT 5.00;
    END IF;

    -- Column: latitude/longitude (talent home base)
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'profiles' AND column_name = 'latitude') THEN
        ALTER TABLE profiles ADD COLUMN latitude DOUBLE PRECISION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'profiles' AND column_name = 'longitude') THEN
        ALTER TABLE profiles ADD COLUMN longitude DOUBLE PRECISION;
    END IF;
END $$;

-- 2. Performance Hardening (Indexes)
-- Add indexes to critical foreign keys and search columns.
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_client_id ON bookings(client_id);
CREATE INDEX IF NOT EXISTS idx_bookings_photographer_id ON bookings(photographer_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_user_id ON post_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_post_id ON post_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_id ON conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);

-- 3. Data Migration (Copying from old tables to unified profiles)
-- Migrate Photographer data
UPDATE profiles p
SET 
  bio = ph.bio,
  tags = ph.tags,
  price_range = ph.price_range,
  location_name = ph.location,
  latitude = ph.latitude,
  longitude = ph.longitude,
  rating = ph.rating
FROM photographers ph
WHERE p.id = ph.id;

-- Migrate Model data
UPDATE profiles p
SET 
  bio = m.bio,
  tags = m.tags,
  price_range = m.price_range,
  location_name = m.location,
  latitude = m.latitude,
  longitude = m.longitude,
  rating = m.rating,
  portfolio_urls = m.portfolio_urls
FROM models m
WHERE p.id = m.id;

-- 4. Monetization Hardening (Denormalized Earnings for performance)
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'profiles' AND column_name = 'total_earnings') THEN
    ALTER TABLE profiles ADD COLUMN total_earnings NUMERIC(15, 2) DEFAULT 0.00;
END IF;

-- 5. Helper Function for Earnings Update
CREATE OR REPLACE FUNCTION update_talent_earnings()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'accepted' AND OLD.status != 'accepted' THEN
        UPDATE profiles
        SET total_earnings = total_earnings + NEW.payout_amount
        WHERE id = NEW.photographer_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_update_talent_earnings ON bookings;
CREATE TRIGGER tr_update_talent_earnings
AFTER UPDATE OF status ON bookings
FOR EACH ROW
EXECUTE FUNCTION update_talent_earnings();
