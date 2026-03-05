-- Bookings + payments tables for MVP workflow
begin;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  requested_date text not null,
  package text not null,
  notes text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_status_check check (status in ('pending', 'accepted', 'completed', 'reviewed', 'cancelled'))
);

create or replace function public.handle_bookings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'bookings_set_updated_at') then
    create trigger bookings_set_updated_at
    before update on public.bookings
    for each row execute function public.handle_bookings_updated_at();
  end if;
end $$;

alter table public.bookings enable row level security;

drop policy if exists bookings_select_participants on public.bookings;
drop policy if exists bookings_insert_client on public.bookings;
drop policy if exists bookings_update_participants on public.bookings;
drop policy if exists bookings_delete_client on public.bookings;

create policy bookings_select_participants on public.bookings
  for select using (auth.uid() = client_id or auth.uid() = photographer_id);
create policy bookings_insert_client on public.bookings
  for insert with check (auth.uid() = client_id);
create policy bookings_update_participants on public.bookings
  for update using (auth.uid() = client_id or auth.uid() = photographer_id);
create policy bookings_delete_client on public.bookings
  for delete using (auth.uid() = client_id);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  provider text not null default 'payfast',
  provider_reference text,
  amount numeric(12,2) not null,
  status text not null default 'initiated',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_status_check check (status in ('initiated', 'pending', 'paid', 'failed', 'cancelled'))
);

create or replace function public.handle_payments_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'payments_set_updated_at') then
    create trigger payments_set_updated_at
    before update on public.payments
    for each row execute function public.handle_payments_updated_at();
  end if;
end $$;

alter table public.payments enable row level security;

drop policy if exists payments_select_participants on public.payments;
drop policy if exists payments_insert_client on public.payments;
drop policy if exists payments_update_participants on public.payments;

create policy payments_select_participants on public.payments
  for select using (
    exists (
      select 1 from public.bookings b
      where b.id = payments.booking_id
        and (auth.uid() = b.client_id or auth.uid() = b.photographer_id)
    )
  );
create policy payments_insert_client on public.payments
  for insert with check (
    exists (
      select 1 from public.bookings b
      where b.id = payments.booking_id
        and auth.uid() = b.client_id
    )
  );
create policy payments_update_participants on public.payments
  for update using (
    exists (
      select 1 from public.bookings b
      where b.id = payments.booking_id
        and (auth.uid() = b.client_id or auth.uid() = b.photographer_id)
    )
  );

commit;
