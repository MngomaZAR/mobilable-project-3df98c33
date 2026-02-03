-- Ensure feed can embed profiles when querying posts, and feed works without auth
begin;

-- Link posts.user_id to profiles so PostgREST can resolve posts -> profiles
alter table public.posts drop constraint if exists posts_user_id_fkey;
alter table public.posts
  add constraint posts_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

-- Allow public read on profiles
drop policy if exists profiles_select_authenticated on public.profiles;
drop policy if exists profiles_select_public on public.profiles;
create policy profiles_select_public on public.profiles
  for select using (true);

commit;
