# EAS / CI Environment Variables (Launch Lock)

These variables are now enforced by `scripts/validate-env.mjs`.

## Legacy provider variables

| Variable | Required | Notes |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | No for release | Legacy/reference Supabase project URL. Ignored when `EXPO_PUBLIC_BACKEND_PROVIDER=api`. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | No for release | Legacy/reference Supabase anon key. Ignored when `EXPO_PUBLIC_BACKEND_PROVIDER=api`. |
| `EXPO_PUBLIC_NHOST_SUBDOMAIN` | No for release client logic | Public Nhost identifier. It may be present for migration, but release traffic must still go through the FastAPI API boundary. |
| `EXPO_PUBLIC_NHOST_REGION` | No for release client logic | Public Nhost region. Server-side Nhost credentials belong in Dokploy/API env, not in the mobile binary. |

## Required for release builds (`validate:env:release`)

| Variable | Required | Allowed values | Notes |
|---|---|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | Yes | Hosted HTTPS URL | Must point to the deployed FastAPI/Dokploy API. The hostname must resolve in public DNS and `/health` plus `/health/contract` must pass. |
| `EXPO_PUBLIC_BACKEND_PROVIDER` | Yes | `api` | Store builds must use the deployed API boundary, not direct Nhost or Supabase calls. |
| `EXPO_PUBLIC_STORE_TARGET` | Yes | `development`, `web`, `internal`, `appstore`, `play`, `both` | Which storefront this build targets |
| `EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER` | Yes | `iap`, `external`, `disabled` | Digital billing mode in-app |
| `EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES` | Yes | `true` / `false` | Hard kill-switch for digital purchases |

## Compliance guard enforced

For `appstore`, `play`, or `both` targets:

- If `EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES=false`, then `EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER` must be `iap`.
- Otherwise, build fails.

This prevents accidental non-compliant store builds that expose external digital checkout.
