-- Initialize a minimal schema for demo and allow anonymous SELECTs for feed

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text,
  city text,
  avatar_url text,
  role text DEFAULT 'client',
  verified boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  caption text,
  location text,
  comment_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  image_url text,
  likes_count integer DEFAULT 0
);

-- Enable RLS and create permissive select policies for demo
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS profiles_select_public ON public.profiles FOR SELECT USING (true);

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS posts_select_public ON public.posts FOR SELECT USING (true);

-- Seed demo profiles
INSERT INTO public.profiles (id, full_name, city, avatar_url)
VALUES
  (gen_random_uuid(), 'Demo photographer', 'Marin Headlands', 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=80&q=80'),
  (gen_random_uuid(), 'Alex Tester', 'Cape Town', 'https://images.unsplash.com/photo-1545996124-1f6d6d6a6f24?auto=format&fit=crop&w=80&q=80')
ON CONFLICT DO NOTHING;

-- Seed demo posts (two posts)
INSERT INTO public.posts (user_id, caption, location, image_url, likes_count)
SELECT p.id, 'Sunrise shoot', 'Marin Headlands', 'https://images.unsplash.com/photo-1504198458649-3128b932f49f?auto=format&fit=crop&w=1200&q=80', 5
FROM public.profiles p WHERE p.full_name = 'Demo photographer'
LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO public.posts (user_id, caption, location, image_url, likes_count)
SELECT p.id, 'City vibes', 'Cape Town', 'https://images.unsplash.com/photo-1482192596544-9eb780fc7f66?auto=format&fit=crop&w=1200&q=80', 2
FROM public.profiles p WHERE p.full_name = 'Alex Tester'
LIMIT 1
ON CONFLICT DO NOTHING;
