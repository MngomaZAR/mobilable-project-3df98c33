# Papzi Monitoring Dashboard Plan

## Phase order

1. launch with manual operations and checklists
2. log every manual intervention for one week
3. build a lean operator dashboard from the incidents that repeat
4. expand into growth and executive reporting once repeat bookings appear

## Week-1 operator dashboard

This is not a BI project. It is a control panel for keeping live bookings, money, and trust healthy.

### Section 1: At-risk bookings

Show the bookings that need attention now.

- upcoming bookings in the next 24 hours
- bookings with no accepted provider
- bookings with overdue ETA or weak ETA confidence
- bookings waiting on manual recovery

### Section 2: Payments and payouts

Show the money states that can become support incidents.

- pending payments older than 15 minutes
- completed payments with booking state mismatch
- escrow awaiting release
- payout-ready bookings not yet paid out

### Section 3: Trust and readiness

Show supply-side blockers.

- pending KYC reviews
- approved creators missing payout method
- active creators with poor response history
- creators removed from core rotation

### Section 4: Ops inbox

Show the queue for the operator running launch control.

- incidents opened today
- unresolved support items
- manual overrides logged today
- high-priority follow-ups due in the next 2 hours

## Dashboard KPIs for week 1

- median lead response time
- payment completion rate
- provider acceptance rate
- booking completion rate
- same-day incident count
- average time to incident resolution
- payout turnaround time

## Build order

### Day 1 dashboard version

- internal admin page or Supabase-backed web view
- read-only tables and counts are fine
- prioritize visibility over polish

### Day 3 dashboard version

- add filters for city, booking status, and incident owner
- add deep links into bookings, payments, and KYC review surfaces
- add a simple manual override log panel

### Day 7 dashboard version

- add trend tiles for recurring incident types
- add creator reliability scoring from real operations
- add daily launch summary for operator handoff

## Data sources

- `bookings`
- `payments`
- `earnings`
- `dispatch_requests`
- `dispatch_offers`
- `eta_snapshots`
- `profiles`
- `kyc_documents`
- `moderation_cases`
- `support_tickets`

Starter queries live in:

- `supabase/sql/monitoring_dashboard_queries.sql`

## Trigger to start the growth engine

Do not accelerate growth until these are true:

- repeat bookings are happening
- incident rate is manageable
- no unresolved payout trust issues exist
- the week-1 dashboard covers the failures operators actually see

When those conditions are true, growth can shift from manual demand seeding to referrals, influencer partnerships, and repeat-booking campaigns.
