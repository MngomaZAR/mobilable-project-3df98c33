-- Phase 1 Verification: Confirming the 03-08 hardened columns
select 
    column_name, 
    data_type 
from 
    information_schema.columns 
where 
    table_schema = 'public' 
    and table_name = 'profiles'
    and column_name in ('status', 'phone', 'bio', 'push_token', 'contact_details');

select 
    column_name, 
    data_type 
from 
    information_schema.columns 
where 
    table_schema = 'public' 
    and table_name = 'bookings'
    and column_name = 'amount_due';

-- Confirm seeding
select count(*) from public.profiles;
select count(*) from public.posts;
