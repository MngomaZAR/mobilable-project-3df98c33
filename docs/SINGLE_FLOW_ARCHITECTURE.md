# Papzi Single-Flow Architecture

## Goal

Papzi should have one clear production path for each core business flow so the team does not split maintenance effort across legacy and current implementations.

## Canonical product flow

1. Discovery
2. Booking request
3. Payment link generation
4. Payment confirmation
5. Dispatch
6. Live tracking
7. Completion
8. Escrow release / earnings / payout

## Canonical payment flow

- App calls `payfast-handler`
- Notify URL comes from `getDefaultPayfastNotifyUrl()`
- PayFast ITN lands on `payfast-handler/notify`
- Booking is updated from that handler path
- Escrow release happens later through `escrow-release`

## Canonical repo structure

- `src/screens`
  User-facing product surfaces
- `src/services`
  Frontend service wrappers for the canonical backend flows
- `src/config`
  Shared policy and environment decisions
- `supabase/functions`
  Active backend contracts only
- `scripts`
  Verification, seeding, and operational tooling
- `docs`
  Architecture, deployment, and operator playbooks

## Rules

- Do not add a second implementation for an existing flow unless the old one is removed in the same change.
- Shared URLs and routing decisions must come from config helpers, not inline strings.
- `npm run audit:single-flow` must pass before release.

## Current enforcement

- Legacy `payfast-sign` and `payfast-itn` codepaths removed from repo
- Payment notify URL centralized in `src/config/commercePolicy.ts`
- Launch gate includes `audit:single-flow`
