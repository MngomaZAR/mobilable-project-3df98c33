-- Ensure feed can embed profiles when querying posts, and feed works without auth
begin;

-- 1. Link posts.user_id to profiles so PostgREST can resolve posts -> profiles for feed
-- (profiles.id = auth.users.id; users who post must have a profile)
alter table public.posts drop constraint if exists posts_user_id_fkey;
alter table public.posts
  add constraint posts_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

-- 2. Allow public read on profiles so feed can show author names when not logged in
drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_public on public.profiles
  for select using (true);

commit;
