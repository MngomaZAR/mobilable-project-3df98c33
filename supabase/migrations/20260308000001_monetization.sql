-- Phase 5: Monetization & Talent Expansion Migration
-- Enhances bookings with financial tracking and implements the 30% commission engine.

-- 1. Add fiscal columns to bookings if they don't exist
do $$
begin
    if not exists (select from information_schema.columns where table_name = 'bookings' and column_name = 'total_amount') then
        alter table bookings add column total_amount numeric(10, 2) default 0.00;
    end if;
    if not exists (select from information_schema.columns where table_name = 'bookings' and column_name = 'commission_amount') then
        alter table bookings add column commission_amount numeric(10, 2) default 0.00;
    end if;
    if not exists (select from information_schema.columns where table_name = 'bookings' and column_name = 'payout_amount') then
        alter table bookings add column payout_amount numeric(10, 2) default 0.00;
    end if;
end $$;

-- 2. Implement calculate_booking_pricing
create or replace function calculate_booking_pricing()
returns trigger as $$
declare
    v_base_rate numeric;
begin
    -- Default logic: 1200 per tiers of '$' in talent price_range
    -- This can be expanded to look up a dynamic rate table
    v_base_rate := 1200.00;
    
    if new.total_amount = 0 or new.total_amount is null then
        new.total_amount := v_base_rate; -- Placeholder for smarter logic
    end if;
    
    new.commission_amount := round(new.total_amount * 0.30, 2);
    new.payout_amount := new.total_amount - new.commission_amount;
    
    return new;
end;
$$ language plpgsql;

drop trigger if exists tr_calculate_booking_pricing on bookings;
create trigger tr_calculate_booking_pricing
before insert or update of total_amount on bookings
for each row execute function calculate_booking_pricing();

-- 3. Implement prevent_booking_overlap
create or replace function prevent_booking_overlap()
returns trigger as $$
begin
    if exists (
        select 1 from bookings
        where photographer_id = new.photographer_id
        and id != new.id
        and status in ('pending', 'accepted')
        and booking_date = new.booking_date -- Simplified string exact match for now
    ) then
        raise exception 'Photographer is already booked for this slot.';
    end if;
    return new;
end;
$$ language plpgsql;

drop trigger if exists tr_prevent_booking_overlap on bookings;
create trigger tr_prevent_booking_overlap
before insert or update on bookings
for each row execute function prevent_booking_overlap();

-- 4. Implement process_payment_transaction
create or replace function process_payment_transaction(
    p_booking_id uuid,
    p_payment_amount integer,
    p_commission_amount integer,
    p_photographer_earnings integer,
    p_photographer_id uuid
)
returns void as $$
begin
    -- Record the split in a ledger or update balance (Future expandability)
    -- For now, ensure the booking status is updated to 'accepted' or 'paid'
    update bookings
    set status = 'accepted',
        total_amount = p_payment_amount / 100.0,
        commission_amount = p_commission_amount / 100.0,
        payout_amount = p_photographer_earnings / 100.0
    where id = p_booking_id;
end;
$$ language plpgsql;

-- 5. Social Counters (sync_post_like_count, sync_post_comment_count)
create or replace function sync_post_like_count()
returns trigger as $$
begin
    if tg_op = 'INSERT' then
        update posts set likes_count = likes_count + 1 where id = new.post_id;
    elsif tg_op = 'DELETE' then
        update posts set likes_count = likes_count - 1 where id = old.post_id;
    end if;
    return null;
end;
$$ language plpgsql;

drop trigger if exists tr_sync_post_like_count on post_likes;
create trigger tr_sync_post_like_count
after insert or delete on post_likes
for each row execute function sync_post_like_count();

create or replace function sync_post_comment_count()
returns trigger as $$
begin
    if tg_op = 'INSERT' then
        update posts set comment_count = comment_count + 1 where id = new.post_id;
    elsif tg_op = 'DELETE' then
        update posts set comment_count = comment_count - 1 where id = old.post_id;
    end if;
    return null;
end;
$$ language plpgsql;

drop trigger if exists tr_sync_post_comment_count on post_comments;
create trigger tr_sync_post_comment_count
after insert or delete on post_comments
for each row execute function sync_post_comment_count();

-- 6. Implement toggle_post_like
create or replace function toggle_post_like(p_post_id uuid, p_user_id uuid)
returns boolean as $$
declare
    v_exists boolean;
begin
    select exists (select 1 from post_likes where post_id = p_post_id and user_id = p_user_id) into v_exists;
    if v_exists then
        delete from post_likes where post_id = p_post_id and user_id = p_user_id;
        return false;
    else
        insert into post_likes (post_id, user_id) values (p_post_id, p_user_id);
        return true;
    end if;
end;
$$ language plpgsql;

-- 7. recommend_posts
create or replace function recommend_posts(
    limit_count integer default 20,
    offset_count integer default 0,
    recency_weight numeric default 0.6,
    popularity_weight numeric default 0.3,
    discussion_weight numeric default 0.1
)
returns setof posts as $$
begin
    return query
    select p.*
    from posts p
    order by (
        (extract(epoch from (now() - p.created_at)) / 3600) * -recency_weight +
        (p.likes_count * popularity_weight) +
        (p.comment_count * discussion_weight)
    ) desc
    limit limit_count
    offset offset_count;
end;
$$ language sql;

-- 8. Utility functions
create or replace function touch_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

create or replace function payments_set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;
