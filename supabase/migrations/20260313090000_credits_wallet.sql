-- Credits wallet + ledger (digital goods only)

create table if not exists public.credits_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credits_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null,
  direction text not null check (direction in ('credit', 'debit')),
  reason text,
  ref_type text,
  ref_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.credits_promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  amount integer not null,
  max_uses integer not null default 1,
  used_count integer not null default 0,
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.credits_wallets enable row level security;
alter table public.credits_ledger enable row level security;
alter table public.credits_promo_codes enable row level security;

drop policy if exists credits_wallets_select_self on public.credits_wallets;
create policy credits_wallets_select_self
  on public.credits_wallets for select
  to public
  using ((select auth.uid()) = user_id);

drop policy if exists credits_ledger_select_self on public.credits_ledger;
create policy credits_ledger_select_self
  on public.credits_ledger for select
  to public
  using ((select auth.uid()) = user_id);

drop policy if exists credits_promo_codes_select_none on public.credits_promo_codes;
create policy credits_promo_codes_select_none
  on public.credits_promo_codes for select
  to public
  using (false);

create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists credits_wallets_touch on public.credits_wallets;
create trigger credits_wallets_touch
  before update on public.credits_wallets
  for each row execute function public.touch_updated_at();

create or replace function public.credits_adjust(
  p_amount integer,
  p_reason text default null,
  p_ref_type text default null,
  p_ref_id uuid default null
)
returns table(balance integer) language plpgsql security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_balance integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_amount = 0 then
    raise exception 'Amount must be non-zero';
  end if;

  insert into public.credits_wallets(user_id, balance)
  values (v_user_id, 0)
  on conflict (user_id) do nothing;

  select balance into v_balance
  from public.credits_wallets
  where user_id = v_user_id
  for update;

  if p_amount < 0 and v_balance + p_amount < 0 then
    raise exception 'Insufficient credits';
  end if;

  update public.credits_wallets
  set balance = balance + p_amount
  where user_id = v_user_id
  returning balance into v_balance;

  insert into public.credits_ledger(user_id, amount, direction, reason, ref_type, ref_id)
  values (
    v_user_id,
    abs(p_amount),
    case when p_amount > 0 then 'credit' else 'debit' end,
    p_reason,
    p_ref_type,
    p_ref_id
  );

  return query select v_balance;
end;
$$;

revoke all on function public.credits_adjust(integer, text, text, uuid) from public;
grant execute on function public.credits_adjust(integer, text, text, uuid) to authenticated;

create or replace function public.credits_redeem_code(p_code text)
returns table(balance integer) language plpgsql security definer
set search_path = public
as $$
declare
  v_code public.credits_promo_codes%rowtype;
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_code is null or length(trim(p_code)) = 0 then
    raise exception 'Code required';
  end if;

  select * into v_code
  from public.credits_promo_codes
  where lower(code) = lower(trim(p_code))
    and active = true
  for update;

  if not found then
    raise exception 'Invalid code';
  end if;
  if v_code.expires_at is not null and v_code.expires_at < now() then
    raise exception 'Code expired';
  end if;
  if v_code.used_count >= v_code.max_uses then
    raise exception 'Code already used';
  end if;

  update public.credits_promo_codes
  set used_count = used_count + 1
  where id = v_code.id;

  return query
    select balance from public.credits_adjust(v_code.amount, 'promo_code', 'promo', v_code.id);
end;
$$;

revoke all on function public.credits_redeem_code(text) from public;
grant execute on function public.credits_redeem_code(text) to authenticated;
