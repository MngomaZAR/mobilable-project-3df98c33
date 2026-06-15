Staging deploy and PayFast verification checklist
===============================================

This file documents the manual and CI steps to deploy Supabase functions, apply DB migrations, and run end-to-end PayFast verification against a staging environment.

Prerequisites
-------------
- `supabase` CLI installed and logged in (or set `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` in CI secrets).
- `STAGING_URL` pointing to the deployed web app / Supabase functions domain.
- PayFast merchant test credentials available: `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE`, `PAYFAST_BASE_URL`, `PAYFAST_VALIDATE_URL`.

Manual staging steps
--------------------
1. Push branch and create a PR (this branch already contains the fixes).

2. Deploy DB migrations and functions to staging (example using supabase CLI):

```bash
# login once locally
npx supabase login

# set project
export SUPABASE_PROJECT_REF=your_project_ref
export SUPABASE_ACCESS_TOKEN=your_access_token

# push DB schema + migrations
npx supabase db push --project-ref $SUPABASE_PROJECT_REF

# deploy functions (example names)
npx supabase functions deploy payfast-handler --project-ref $SUPABASE_PROJECT_REF --no-verify
npx supabase functions deploy payfast-itn --project-ref $SUPABASE_PROJECT_REF --no-verify

``` 

3. Configure production/staging env vars (in Supabase project Settings -> Environment Variables):

- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY (only if needed server-side)
- PAYFAST_MERCHANT_ID
- PAYFAST_MERCHANT_KEY
- PAYFAST_PASSPHRASE
- PAYFAST_BASE_URL (sandbox or live)
- PAYFAST_VALIDATE_URL
- PAYFAST_ITN_ALLOWED_IPS (optional allowlist)

4. Set PayFast merchant notify URL to:

```
${STAGING_URL}/functions/v1/payfast-handler/notify
```

5. Smoke test the checkout flow:

- Create a test booking and request a PayFast checkout link via the app or the `payfast-handler` function.
- Complete checkout using PayFast sandbox.
- Confirm the ITN is received and the booking `payments` row and `bookings` status update to `completed`/`accepted`.

CI automation
-------------
Use the provided GitHub Actions workflow `.github/workflows/playwright-staging.yml` to run Playwright tests against staging. Set the secret `STAGING_URL` in the repository settings before dispatching.

Secrets to add to CI
--------------------
- `STAGING_URL` — base URL used by Playwright tests
- `SUPABASE_ACCESS_TOKEN` — (optional) for automated supabase deploys
- `SUPABASE_PROJECT_REF` — (optional) for automated supabase deploys

If you want, I can add an automated deploy workflow that runs on merge to `main` using these secrets.
