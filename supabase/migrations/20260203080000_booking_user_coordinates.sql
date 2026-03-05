begin;

alter table public.bookings
  add column if not exists user_latitude numeric,
  add column if not exists user_longitude numeric;

commit;
