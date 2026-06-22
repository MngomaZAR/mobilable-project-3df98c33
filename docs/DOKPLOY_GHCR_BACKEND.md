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

## Dokploy Variables

Set these in Dokploy, not in EAS:

```env
NEON_DATABASE_URL=
KEYCLOAK_URL=
KEYCLOAK_REALM=papzi
KEYCLOAK_AUDIENCE=papzi-mobile
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
EXPO_PUBLIC_API_BASE_URL=https://api.your-domain.example
EXPO_PUBLIC_STORE_TARGET=both
EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER=external
EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES=true
```

`EXPO_PUBLIC_API_BASE_URL=https://api.example.com` is a blocking placeholder. Replace it with the real Dokploy API URL before release builds.

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
