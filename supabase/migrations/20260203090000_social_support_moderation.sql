begin;

create table if not exists public.post_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  category text not null default 'general',
  description text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  reason text not null,
  details text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  reason text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  name text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.error_reports (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  message text not null,
  stack text,
  context jsonb,
  created_at timestamptz not null default now()
);

alter table public.post_likes enable row level security;
alter table public.post_comments enable row level security;
alter table public.support_tickets enable row level security;
alter table public.reports enable row level security;
alter table public.account_deletion_requests enable row level security;
alter table public.analytics_events enable row level security;
alter table public.error_reports enable row level security;

drop policy if exists post_likes_select_auth on public.post_likes;
drop policy if exists post_likes_insert_auth on public.post_likes;
drop policy if exists post_likes_delete_auth on public.post_likes;
create policy post_likes_select_auth on public.post_likes for select using (auth.uid() is not null);
create policy post_likes_insert_auth on public.post_likes for insert with check (auth.uid() = user_id);
create policy post_likes_delete_auth on public.post_likes for delete using (auth.uid() = user_id);

drop policy if exists post_comments_select_auth on public.post_comments;
drop policy if exists post_comments_insert_auth on public.post_comments;
drop policy if exists post_comments_delete_owner on public.post_comments;
create policy post_comments_select_auth on public.post_comments for select using (auth.uid() is not null);
create policy post_comments_insert_auth on public.post_comments for insert with check (auth.uid() = user_id);
create policy post_comments_delete_owner on public.post_comments for delete using (auth.uid() = user_id);

drop policy if exists support_tickets_select_owner on public.support_tickets;
drop policy if exists support_tickets_insert_owner on public.support_tickets;
drop policy if exists support_tickets_update_owner on public.support_tickets;
create policy support_tickets_select_owner on public.support_tickets
  for select using (auth.uid() = created_by);
create policy support_tickets_insert_owner on public.support_tickets
  for insert with check (auth.uid() = created_by);
create policy support_tickets_update_owner on public.support_tickets
  for update using (auth.uid() = created_by);

drop policy if exists support_tickets_select_admin on public.support_tickets;
drop policy if exists support_tickets_update_admin on public.support_tickets;
create policy support_tickets_select_admin on public.support_tickets
  for select using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy support_tickets_update_admin on public.support_tickets
  for update using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

drop policy if exists reports_select_owner on public.reports;
drop policy if exists reports_insert_owner on public.reports;
create policy reports_select_owner on public.reports
  for select using (auth.uid() = created_by);
create policy reports_insert_owner on public.reports
  for insert with check (auth.uid() = created_by);

drop policy if exists reports_select_admin on public.reports;
drop policy if exists reports_update_admin on public.reports;
create policy reports_select_admin on public.reports
  for select using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy reports_update_admin on public.reports
  for update using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

drop policy if exists account_deletion_select_owner on public.account_deletion_requests;
drop policy if exists account_deletion_insert_owner on public.account_deletion_requests;
create policy account_deletion_select_owner on public.account_deletion_requests
  for select using (auth.uid() = created_by);
create policy account_deletion_insert_owner on public.account_deletion_requests
  for insert with check (auth.uid() = created_by);

drop policy if exists account_deletion_select_admin on public.account_deletion_requests;
drop policy if exists account_deletion_update_admin on public.account_deletion_requests;
create policy account_deletion_select_admin on public.account_deletion_requests
  for select using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy account_deletion_update_admin on public.account_deletion_requests
  for update using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

drop policy if exists analytics_insert_auth on public.analytics_events;
create policy analytics_insert_auth on public.analytics_events
  for insert with check (auth.uid() is not null or created_by is null);

drop policy if exists error_reports_insert_auth on public.error_reports;
create policy error_reports_insert_auth on public.error_reports
  for insert with check (auth.uid() is not null or created_by is null);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists support_tickets_touch on public.support_tickets;
create trigger support_tickets_touch
before update on public.support_tickets
for each row execute function public.touch_updated_at();

drop trigger if exists reports_touch on public.reports;
create trigger reports_touch
before update on public.reports
for each row execute function public.touch_updated_at();

drop trigger if exists account_deletion_touch on public.account_deletion_requests;
create trigger account_deletion_touch
before update on public.account_deletion_requests
for each row execute function public.touch_updated_at();

create or replace function public.sync_post_like_count()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT') then
    update public.posts
    set likes_count = coalesce(likes_count, 0) + 1
    where id = new.post_id;
  elsif (tg_op = 'DELETE') then
    update public.posts
    set likes_count = greatest(coalesce(likes_count, 0) - 1, 0)
    where id = old.post_id;
  end if;
  return null;
end;
$$;

create or replace function public.sync_post_comment_count()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT') then
    update public.posts
    set comment_count = coalesce(comment_count, 0) + 1
    where id = new.post_id;
  elsif (tg_op = 'DELETE') then
    update public.posts
    set comment_count = greatest(coalesce(comment_count, 0) - 1, 0)
    where id = old.post_id;
  end if;
  return null;
end;
$$;

drop trigger if exists post_likes_sync on public.post_likes;
create trigger post_likes_sync
after insert or delete on public.post_likes
for each row execute function public.sync_post_like_count();

drop trigger if exists post_comments_sync on public.post_comments;
create trigger post_comments_sync
after insert or delete on public.post_comments
for each row execute function public.sync_post_comment_count();

commit;
