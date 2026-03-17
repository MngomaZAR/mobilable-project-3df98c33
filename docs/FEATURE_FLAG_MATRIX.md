# Papzi Feature Flag Matrix

| Flag | Scope | Default | Purpose |
|---|---|---:|---|
| `dispatch_multi_provider_enabled` | market/role | on | Enables fanout dispatch to 1-5 providers. |
| `dispatch_sla_seconds` | market | 90 | SLA timeout for offer expiry. |
| `eta_high_frequency_mode` | risk-tier | off | 10s ETA refresh for active incidents. |
| `for_you_backend_ranking` | market | on | Uses `for-you-ranking` edge function ordering. |
| `heatmap_overlay_enabled` | market | on | Shows demand/supply pulse on map. |
| `strict_consent_enforcement` | market | on | Blocks gated actions when consent missing. |
| `moderation_auto_hide_repeat` | risk-tier | on | Auto-hides repeated policy violators. |
| `ppv_unlock_enabled` | market | on | Enables production post unlock entitlement path. |
