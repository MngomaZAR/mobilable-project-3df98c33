-- Reset schema to the initial minimal feature set with fresh RLS policies
begin;

create extension if not exists "pgcrypto";

-- Drop every public table (except schema_migrations) along with dependent objects
do $$
declare
  r record;
begin
  for r in (
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename not in ('schema_migrations')
  ) loop
    execute format('drop table if exists public.%I cascade', r.tablename);
  end loop;
end $$;

-- Drop leftover enum types created by previous features
do $$
declare
  r record;
begin
  for r in (
    select typname
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typtype = 'e'
  ) loop
    execute format('drop type if exists public.%I cascade', r.typname);
  end loop;
end $$;

-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  city text,
  role text not null default 'client',
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_profiles_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'profiles_set_updated_at') then
    create trigger profiles_set_updated_at
    before update on public.profiles
    for each row execute function public.handle_profiles_updated_at();
  end if;
end $$;

alter table public.profiles enable row level security;

drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated on public.profiles
  for select using (auth.uid() is not null);
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (auth.uid() = id);
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (auth.uid() = id);
drop policy if exists profiles_delete_self on public.profiles;
create policy profiles_delete_self on public.profiles
  for delete using (auth.uid() = id);

-- Photographers
create table public.photographers (
  id uuid primary key references public.profiles(id) on delete cascade,
  rating numeric(3,2) not null default 4.80,
  location text not null default 'South Africa',
  latitude double precision,
  longitude double precision,
  price_range text default 'R1500',
  style text,
  bio text,
  tags text[] not null default '{}',
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint photographers_rating_range check (rating >= 0 and rating <= 5)
);

create or replace function public.handle_photographers_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'photographers_set_updated_at') then
    create trigger photographers_set_updated_at
    before update on public.photographers
    for each row execute function public.handle_photographers_updated_at();
  end if;
end $$;

create index if not exists photographers_location_idx on public.photographers using gin (to_tsvector('simple', coalesce(location, '')));
create index if not exists photographers_tags_idx on public.photographers using gin (tags);

alter table public.photographers enable row level security;

drop policy if exists photographers_select_public on public.photographers;
create policy photographers_select_public on public.photographers
  for select using (true);
drop policy if exists photographers_insert_self on public.photographers;
create policy photographers_insert_self on public.photographers
  for insert with check (auth.uid() = id);
drop policy if exists photographers_update_self on public.photographers;
create policy photographers_update_self on public.photographers
  for update using (auth.uid() = id);
drop policy if exists photographers_delete_self on public.photographers;
create policy photographers_delete_self on public.photographers
  for delete using (auth.uid() = id);

-- Conversations
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  created_by uuid references auth.users(id) on delete set null,
  last_message text,
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.conversations enable row level security;

drop policy if exists conversations_select_authenticated on public.conversations;
create policy conversations_select_authenticated on public.conversations
  for select using (auth.uid() is not null);
drop policy if exists conversations_insert_creator on public.conversations;
create policy conversations_insert_creator on public.conversations
  for insert with check (auth.uid() = created_by or created_by is null);
drop policy if exists conversations_update_creator on public.conversations;
create policy conversations_update_creator on public.conversations
  for update using (auth.uid() = created_by);
drop policy if exists conversations_delete_creator on public.conversations;
create policy conversations_delete_creator on public.conversations
  for delete using (auth.uid() = created_by);

-- Messages
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.conversations(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint messages_chat_id_or_conversation_id check (chat_id is not null or conversation_id is not null)
);

create index messages_chat_idx on public.messages(chat_id);
create index messages_conversation_idx on public.messages(conversation_id);

alter table public.messages enable row level security;

drop policy if exists messages_select_authenticated on public.messages;
create policy messages_select_authenticated on public.messages
  for select using (auth.uid() is not null);
drop policy if exists messages_insert_self on public.messages;
create policy messages_insert_self on public.messages
  for insert with check (auth.uid() = sender_id);
drop policy if exists messages_delete_self on public.messages;
create policy messages_delete_self on public.messages
  for delete using (auth.uid() = sender_id);

-- Posts
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  caption text,
  image_url text,
  location text,
  likes_count integer not null default 0,
  comment_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- Comments
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  body text,
  created_at timestamptz not null default now()
);

-- Likes
create table public.likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index likes_unique_post_user on public.likes(post_id, user_id);

alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.likes enable row level security;

drop policy if exists posts_select_public on public.posts;
create policy posts_select_public on public.posts for select using (true);
drop policy if exists posts_insert_owner on public.posts;
create policy posts_insert_owner on public.posts for insert with check (auth.uid() = user_id);
drop policy if exists posts_update_owner on public.posts;
create policy posts_update_owner on public.posts for update using (auth.uid() = user_id);
drop policy if exists posts_delete_owner on public.posts;
create policy posts_delete_owner on public.posts for delete using (auth.uid() = user_id);

drop policy if exists comments_select_public on public.comments;
create policy comments_select_public on public.comments for select using (true);
drop policy if exists comments_insert_owner on public.comments;
create policy comments_insert_owner on public.comments for insert with check (auth.uid() = user_id);
drop policy if exists comments_delete_owner on public.comments;
create policy comments_delete_owner on public.comments for delete using (auth.uid() = user_id);

drop policy if exists likes_select_public on public.likes;
create policy likes_select_public on public.likes for select using (true);
drop policy if exists likes_insert_owner on public.likes;
create policy likes_insert_owner on public.likes for insert with check (auth.uid() = user_id);
drop policy if exists likes_delete_owner on public.likes;
create policy likes_delete_owner on public.likes for delete using (auth.uid() = user_id);

-- Recommend posts function
create or replace function public.recommend_posts(
  limit_count int default 20,
  offset_count int default 0,
  recency_weight numeric default 0.6,
  popularity_weight numeric default 0.3,
  discussion_weight numeric default 0.1
) returns table (
  id uuid,
  user_id uuid,
  caption text,
  image_url text,
  location text,
  likes integer,
  comment_count integer,
  created_at timestamptz,
  score numeric
) language sql stable as $$
  with engagement as (
    select
      p.id,
      p.user_id,
      p.caption,
      p.image_url,
      p.location,
      p.created_at,
      coalesce(lc.like_count, 0) as like_count,
      coalesce(cc.comment_count, 0) as comment_count,
      extract(epoch from (now() - p.created_at)) / 3600 as age_hours
    from public.posts p
    left join lateral (
      select count(*)::int as like_count
      from public.likes l
      where l.post_id = p.id
    ) lc on true
    left join lateral (
      select count(*)::int as comment_count
      from public.comments c
      where c.post_id = p.id
    ) cc on true
  )
  select
    id,
    user_id,
    caption,
    image_url,
    location,
    like_count as likes,
    comment_count,
    created_at,
    (recency_weight * exp(-age_hours / 72)) +
    (popularity_weight * ln(1 + like_count)) +
    (discussion_weight * ln(1 + comment_count)) as score
  from engagement
  order by score desc, created_at desc
  limit limit_count offset offset_count;
$$;

commit;
