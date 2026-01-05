-- Migration: add recommend_posts RPC and tighten engagement tables
create extension if not exists "pgcrypto";

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  caption text,
  image_url text,
  location text,
  likes_count integer not null default 0,
  comment_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  body text,
  created_at timestamptz not null default now()
);

create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists likes_unique_post_user on public.likes(post_id, user_id);

alter table public.posts enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;

create policy if not exists posts_select_public on public.posts for select using (true);
create policy if not exists posts_insert_owner on public.posts for insert with check (auth.uid() = user_id);
create policy if not exists posts_update_owner on public.posts for update using (auth.uid() = user_id);
create policy if not exists posts_delete_owner on public.posts for delete using (auth.uid() = user_id);

create policy if not exists likes_select_public on public.likes for select using (true);
create policy if not exists likes_insert_owner on public.likes for insert with check (auth.uid() = user_id);
create policy if not exists likes_delete_owner on public.likes for delete using (auth.uid() = user_id);

create policy if not exists comments_select_public on public.comments for select using (true);
create policy if not exists comments_insert_owner on public.comments for insert with check (auth.uid() = user_id);
create policy if not exists comments_delete_owner on public.comments for delete using (auth.uid() = user_id);

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
