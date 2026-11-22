-- Do not allow a new payment to become completed without a provider receipt.
-- Existing legacy rows are intentionally left untouched for manual reconciliation.

begin;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_completed_requires_provider_id'
  ) then
    alter table public.payments
      add constraint payments_completed_requires_provider_id
      check (
        status not in ('completed', 'paid')
        or nullif(trim(provider_payment_id), '') is not null
      ) not valid;
  end if;
end
$$;

create index if not exists payments_unverified_completed_idx
  on public.payments (status, updated_at)
  where status in ('completed', 'paid')
    and nullif(trim(provider_payment_id), '') is null;

commit;
