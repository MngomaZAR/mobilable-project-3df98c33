-- Papzi monitoring dashboard starter queries
-- Use these in Supabase SQL editor or saved queries during the first 100 users phase.

-- 1. Pending KYC workload
select
  status,
  count(*) as total
from public.kyc_documents
group by status
order by status;

-- 2. Payment health
select
  status,
  count(*) as total,
  coalesce(sum(amount), 0) as gross_amount
from public.payments
group by status
order by status;

-- 3. Recent failed or cancelled payments
select
  id,
  booking_id,
  customer_id,
  amount,
  status,
  created_at
from public.payments
where status in ('failed', 'cancelled')
order by created_at desc
limit 100;

-- 4. Bookings stuck before completion
select
  id,
  client_id,
  photographer_id,
  status,
  assignment_state,
  created_at
from public.bookings
where status in ('pending', 'accepted')
order by created_at asc
limit 100;

-- 5. Escrow / payout release candidates
select
  b.id as booking_id,
  b.status as booking_status,
  b.price_total,
  e.id as earning_id,
  e.amount as earning_amount,
  e.created_at as earning_created_at
from public.bookings b
left join public.earnings e on e.source_id = b.id
where b.status in ('completed', 'paid_out')
order by b.created_at desc
limit 100;

-- 6. Dispatch pressure
select
  status,
  count(*) as total
from public.dispatch_requests
group by status
order by status;

-- 7. Active ETA confidence
select
  booking_id,
  eta_minutes,
  eta_confidence,
  distance_km,
  created_at
from public.eta_snapshots
order by created_at desc
limit 100;

-- 8. Moderation queue
select
  status,
  severity,
  count(*) as total
from public.moderation_cases
group by status, severity
order by severity desc, status;

-- 9. Support backlog
select
  status,
  priority,
  count(*) as total
from public.support_tickets
group by status, priority
order by priority desc, status;
