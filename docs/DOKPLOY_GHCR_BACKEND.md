# PAPZII Dokploy + GHCR Backend Deployment

This deployment path avoids Docker Hub. GitHub Actions publishes backend images to GitHub Container Registry using the built-in `GITHUB_TOKEN`.

## Existing Config Inventory

Already found:

- EAS production public env: Expo store flags, `EXPO_PUBLIC_BACKEND_PROVIDER`, Nhost public subdomain/region, Supabase public URL/key.
- Supabase function secrets: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `PAYFAST_BASE_URL`, `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE`, and related PayFast validation values.
- GitHub workflow references: `EXPO_TOKEN`, Supabase public env names.
- Local iOS credentials under `credentials/ios/`.

Not found through available tools:

- Docker Hub account or token.
- GitHub repo secret listing, because `gh` is not installed and the GitHub secrets connector is not exposed in this session.
- Neon, Keycloak, MinIO, NATS, Typesense, or Dokploy env values.

## GHCR Images

The workflow builds:

- `ghcr.io/mngomazar/papzi-api`
- `ghcr.io/mngomazar/papzi-worker`

Tags include commit SHA, branch names, and `latest`. The Dokploy compose file uses `latest` by default.

The GHCR manifest endpoint currently returns HTTP 401 without credentials, so Dokploy must either:

- pull with a GitHub token that has package read access, or
- use packages that have been made public in GitHub Container Registry.

`deployment/docker-compose.yml` sets `pull_policy: always` for the API and worker so Dokploy pulls the latest GHCR image during redeploys.

## GitHub to Dokploy Redeploy

`.github/workflows/deploy-backend-dokploy.yml` triggers after `Build Backend Images` completes successfully, and can also be run manually.

Required GitHub repository secrets:

```env
DOKPLOY_URL=https://your-dokploy-host.example
DOKPLOY_API_KEY=your-dokploy-api-key
DOKPLOY_COMPOSE_ID=your-dokploy-compose-id
DOKPLOY_API_HEALTH_URL=https://api.papzii.co.za/health
# Optional. Defaults to DOKPLOY_API_HEALTH_URL with /health replaced by /health/contract.
DOKPLOY_API_CONTRACT_URL=https://api.papzii.co.za/health/contract
```

The workflow calls Dokploy's `POST /api/compose.redeploy` endpoint, waits for the API health route to return `{"status":"ok"}`, then waits for `/health/contract` to return `{"ok":true}`. A live container is not enough for release; the backend must prove it can see the app tables and required columns.

## Domain/DNS

The available hosting details found for this project are for `papzii.co.za`, not `papzi.co.za`.

Current DNS status at the time this deployment path was prepared:

- `papzii.co.za` resolves to the Register Domain shared hosting IP.
- `api.papzii.co.za` does not resolve yet.
- `papzi.co.za` and `api.papzi.co.za` do not resolve.

Before a mobile release build can pass, create a public API hostname, preferably:

```text
api.papzii.co.za -> Dokploy VPS public IP
```

Then set EAS production:

```env
EXPO_PUBLIC_API_BASE_URL=https://api.papzii.co.za
```

## Dokploy Variables

Set these in Dokploy, not in EAS:

```env
NEON_DATABASE_URL=
DATABASE_URL=
NHOST_SUBDOMAIN=otismbqjmpvvtygfjbcu
NHOST_REGION=ap-southeast-1
NHOST_AUTH_URL=
NHOST_GRAPHQL_URL=
NHOST_FUNCTIONS_URL=
NHOST_ADMIN_SECRET=
KEYCLOAK_URL=
KEYCLOAK_REALM=papzi
KEYCLOAK_AUDIENCE=papzi-mobile
KEYCLOAK_CLIENT_SECRET=
KEYCLOAK_ADMIN_PASSWORD=
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=
TYPESENSE_API_KEY=
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
PAYFAST_BASE_URL=
PAYFAST_MERCHANT_ID=
PAYFAST_MERCHANT_KEY=
PAYFAST_PASSPHRASE=
```

Reuse the existing Supabase secret names for PayFast and LiveKit when copying values into Dokploy. Do not create renamed duplicates unless the backend code requires a new name.

## Expo/EAS Variables

Only public mobile configuration belongs in EAS:

```env
EXPO_PUBLIC_BACKEND_PROVIDER=api
EXPO_PUBLIC_API_BASE_URL=https://api.papzii.co.za
EXPO_PUBLIC_STORE_TARGET=both
EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER=external
EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES=true
```

`EXPO_PUBLIC_API_BASE_URL=https://api.example.com` is a blocking placeholder. Replace it with the real Dokploy API URL before release builds.

The mobile release provider is now `api`. Nhost/Supabase values may exist during migration, but the shipped app should call only the FastAPI host from `EXPO_PUBLIC_API_BASE_URL`.

The app expects these FastAPI routes:

- `GET /health`
- `GET /health/contract`
- `GET /version`
- `GET /auth/me`
- `POST /auth/sign-in`
- `POST /auth/sign-up`
- `POST /auth/sign-out`
- `POST /data/{table}`
- `POST /rpc/{name}`
- `POST /graphql`
- `POST /storage/upload`
- `POST /storage/signed-url`
- `POST /functions/{name}`

## Local Checks

```bash
docker compose -f deployment/docker-compose.yml --env-file deployment/dokploy.env.example config
docker build -f backend/api/Dockerfile -t papzi-api:local .
docker build -f backend/worker/Dockerfile -t papzi-worker:local .
```

The mobile release gate should remain blocked until:

```bash
npm run audit:architecture
npm run validate:env:release
npm run check:launch
```

`validate:env:release` checks both `/health` and `/health/contract`. If the app schema is missing from the configured Postgres/Nhost backend, release validation must fail before EAS builds a broken binary.
