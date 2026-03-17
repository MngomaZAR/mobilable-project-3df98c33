# Papzi Incident Playbook

## 1. Dispatch Degradation
- Trigger: rising queued/offered dispatch requests, low acceptance rate.
- Immediate actions:
  - Call `dispatch_expire_open_requests` RPC.
  - Reduce default `fanout_count` to 1 and `sla_timeout_seconds` to 60 via remote config.
  - Disable multi-provider mode for new sessions with feature flag.
- Recovery checks:
  - Open dispatch count trending down.
  - Median offer response < 60s.

## 2. ETA Instability
- Trigger: ETA confidence drops below 0.55 average.
- Immediate actions:
  - Increase snapshot cadence from 15s to 10s for active bookings.
  - Force fallback ETA model (`haversine_fallback`) while route provider recovers.
  - Alert ops channel with affected booking IDs.
- Recovery checks:
  - Confidence >= 0.70 on rolling 100 snapshots.

## 3. Moderation Backlog
- Trigger: open/in_review/escalated cases > SLA threshold.
- Immediate actions:
  - Prioritize severity 4-5 cases first.
  - Auto-hide newly flagged repeat offenders.
  - Staff-on-call escalates unresolved > 24h.
- Recovery checks:
  - 95% of severity 4+ cases resolved within SLA.

## 4. Payment or Payout Exceptions
- Trigger: failed/cancelled payment spike.
- Immediate actions:
  - Switch checkout to degraded-safe mode (disable nonessential upsells).
  - Queue retry jobs for pending settlement events.
  - Freeze creator payout releases for inconsistent ledger batches.
- Recovery checks:
  - failure rate back to baseline.
  - ledger reconciliation passes.

## 5. Realtime Outage
- Trigger: websocket/subscription failures across booking/chat.
- Immediate actions:
  - Activate polling fallback every 10-15s.
  - Show "Live sync degraded" banner in app.
  - Persist write actions in retry queue.
- Recovery checks:
  - realtime channels healthy.
  - retry queue drained.
