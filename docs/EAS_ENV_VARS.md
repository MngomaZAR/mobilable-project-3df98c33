# EAS / CI Environment Variables (Launch Lock)

These variables are now enforced by `scripts/validate-env.mjs`.

## Required in all CI environments

| Variable | Required | Notes |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key |

## Required for release builds (`validate:env:release`)

| Variable | Required | Allowed values | Notes |
|---|---|---|---|
| `EXPO_PUBLIC_STORE_TARGET` | Yes | `development`, `web`, `internal`, `appstore`, `play`, `both` | Which storefront this build targets |
| `EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER` | Yes | `iap`, `external`, `disabled` | Digital billing mode in-app |
| `EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES` | Yes | `true` / `false` | Hard kill-switch for digital purchases |

## Compliance guard enforced

For `appstore`, `play`, or `both` targets:

- If `EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES=false`, then `EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER` must be `iap`.
- Otherwise, build fails.

This prevents accidental non-compliant store builds that expose external digital checkout.
