# Papzi Manual Fallback Ops

## Principle

When automation is uncertain, operators must still be able to complete the customer journey without breaking trust, money flow, or auditability.

Every fallback should answer three questions:

1. what is the customer experiencing right now
2. what state is the database currently in
3. what manual action is safe to take next

## Golden rules

- never guess on payment state
- never approve KYC without document review
- never release escrow without booking completion evidence
- never tell the customer a booking is confirmed until provider acceptance is verified
- every manual override must be logged with actor, reason, booking ID, and timestamp

## Fallbacks by flow

### Auth

- create or reset support users through Supabase admin tooling
- verify auth user, `profiles` row, and role alignment
- if signup succeeds but profile is missing, repair profile before the user continues

### KYC

- review documents in admin moderation
- confirm document readability and identity match
- only then move creator to `approved`
- if documents are unclear, keep status pending and ask for resubmission

### Payments

- verify `payments` row exists and matches the booking
- verify checkout link creation from `payfast-handler`
- if payment state is delayed, inspect `payments`, `bookings`, and function logs before any manual correction
- do not mark a payment completed from customer claim alone

### Dispatch

- if auto-dispatch stalls, contact approved providers manually
- maintain one primary provider and two backups for each live booking
- only mark the booking forward after confirmed provider acceptance

### Payouts

- confirm booking status is eligible
- confirm earnings rows and payout method exist
- reconcile every manual payout with booking ID and user ID
- if payout must be delayed, inform the creator before they ask

### Support

- keep one operator note per incident with user, booking, payment, and resolution
- track owner, next action, and resolution SLA

## Incident response playbooks

### Missed booking or no-show

#### Immediate actions

1. contact the client within 5 minutes
2. contact the assigned provider immediately
3. activate the backup provider list
4. decide whether to recover, reschedule, or refund within 15 minutes

#### Customer message

We’re on it right now. Your booking has hit a provider issue and I’m already working on the fastest recovery option for you. I’ll update you again within 10 minutes with either a replacement, revised ETA, or refund/reschedule choice.

#### Internal resolution rule

- if replacement can arrive in a reasonable window, offer replacement first
- if the booking is time-sensitive and recovery is weak, offer refund or reschedule quickly
- record the provider failure and remove repeat offenders from the core rotation

### Payment completed by customer claim but not reflected in app

#### Immediate actions

1. check `payments` by booking ID
2. check `bookings` status
3. check `payfast-handler` logs
4. verify merchant reference before any manual correction

#### Resolution rule

- if the payment is verified, align the booking state
- if not verified, do not promise confirmation
- keep the customer updated every 10 minutes while investigating

### Payout delayed

#### Immediate actions

1. confirm booking is completed or paid out
2. confirm payout method exists
3. confirm `earnings` rows exist
4. verify whether `escrow-release` already ran

#### Creator message

Your payout is under review on our side and I’m checking the payout state against the booking now. I’ll confirm the exact status and next step for you shortly.

#### Resolution rule

- if funds are ready, release or reconcile promptly
- if funds are blocked by missing data, request the missing item clearly
- never leave the creator in silence on money issues

## Manual override log template

- incident ID
- date and time
- operator
- user ID
- booking ID
- payment ID if applicable
- issue summary
- verified database state
- manual action taken
- customer outcome
- follow-up required
