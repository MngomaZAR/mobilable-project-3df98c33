-- Enforce server-side pricing on bookings
begin;

alter table public.bookings
  add column if not exists pricing_mode text,
  add column if not exists photo_count integer,
  add column if not exists event_package_id text,
  add column if not exists distance_km numeric,
  add column if not exists price_total numeric,
  add column if not exists currency text,
  add column if not exists commission_rate numeric,
  add column if not exists commission_amount numeric,
  add column if not exists photographer_payout numeric;

create or replace function public.calculate_booking_pricing()
returns trigger
language plpgsql
as $$
declare
  base_per_photo numeric := 10;
  distance_fee_per_km numeric := 0.75;
  commission_rate numeric := 0.30;
  rating numeric := 0;
  rating_multiplier numeric := 1.0;
  base_price numeric := 0;
  distance_fee numeric := 0;
begin
  if new.pricing_mode is null then
    new.pricing_mode := 'paparazzi';
  end if;
  if new.photo_count is null and new.pricing_mode = 'paparazzi' then
    new.photo_count := 4;
  end if;
  if new.event_package_id is null and new.pricing_mode = 'event' then
    new.event_package_id := 'birthday';
  end if;
  if new.distance_km is null then
    new.distance_km := 0;
  end if;
  if new.currency is null then
    new.currency := 'ZAR';
  end if;

  select coalesce(p.rating, 0)
  into rating
  from public.photographers p
  where p.id = new.photographer_id;

  if rating >= 4.8 then
    rating_multiplier := 1.30;
  elsif rating >= 4.4 then
    rating_multiplier := 1.15;
  elsif rating >= 4.0 then
    rating_multiplier := 1.00;
  else
    rating_multiplier := 0.90;
  end if;

  if new.pricing_mode = 'event' then
    base_price := case new.event_package_id
      when 'wedding' then 900
      when 'corporate' then 600
      else 250
    end;
  else
    base_price := base_per_photo * greatest(1, new.photo_count);
  end if;

  distance_fee := distance_fee_per_km * greatest(0, new.distance_km);
  new.price_total := round((base_price + distance_fee) * rating_multiplier * 100) / 100;
  new.commission_rate := commission_rate;
  new.commission_amount := round(new.price_total * commission_rate * 100) / 100;
  new.photographer_payout := round((new.price_total - new.commission_amount) * 100) / 100;

  return new;
end;
$$;

drop trigger if exists bookings_pricing_set on public.bookings;
create trigger bookings_pricing_set
before insert or update on public.bookings
for each row execute function public.calculate_booking_pricing();

commit;
