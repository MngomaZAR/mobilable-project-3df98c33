# PAPZII Release Recovery Audit

Date: 2026-07-22

Status: not public-deployable yet.

The repository has the right release direction now: mobile traffic is configured to go through a FastAPI boundary and the architecture audit finds all 44 screens behind service/config layers. The live release is still blocked because the configured production API host is not reachable and the server-side data provider behind FastAPI is not reachable.

## Current Evidence

| Area | Result | Evidence |
| --- | --- | --- |
| Mobile release provider | Configured for API boundary | `eas.json` production uses `EXPO_PUBLIC_BACKEND_PROVIDER=api` and `EXPO_PUBLIC_API_BASE_URL=https://api.papzii.co.za`. |
| API DNS | Failing | `api.papzii.co.za` returns NXDOMAIN from Google DNS. |
| Release env gate | Failing correctly | `npm run validate:env:release` fails because `api.papzii.co.za` does not resolve. |
| Architecture audit | Passing | `npm run audit:architecture` reports 44 screens, 23 services, and 0 blockers. |
| Release runtime audit | Passing | `npm run audit:release-runtime` scanned 138 files and reported 0 findings. |
| Source/connectivity audit | Passing | `npm run audit:src` reports 5 checks, 0 failed, 0 warnings. |
| Live schema reference audit | Passing | `npm run audit:live-schema` reports 58 referenced tables, 71 live tables, and 0 findings. |
| Dashboard role audit | Passing | `npm run audit:dashboards` verifies client, photographer, model, and admin dashboard route contracts. |
| TypeScript/lint/Jest | Passing | `npm run typecheck`, `npm run lint`, and `npx jest --runInBand --passWithNoTests` pass locally. |
| Web export | Passing | `npm run build:web` completed and exported `dist`. |
| Maps routing | Passing focused test | `npx jest __tests__/services/routingService.test.ts --runInBand --passWithNoTests` passes. OSRM road geometry is requested with `overview=full&geometries=geojson&steps=true`. |
| Backend upstream diagnostics | Improved | `/health/contract`, `/auth/sign-in`, and `/functions/{name}` now return structured 503 responses when Nhost upstream DNS is unreachable. |
| Docker Compose config | Passing | `docker compose -f deployment/docker-compose.yml --env-file deployment/dokploy.env.example config --quiet` passes. |
| Docker image build | Not locally verified | `docker build -f backend/api/Dockerfile -t papzi-api:local .` cannot connect because Docker Desktop's Linux engine pipe is not running. |
| Store build/submission | Blocked | A new TestFlight/Play build should not be produced until `/health` and `/health/contract` pass on a public HTTPS API host. |

## Connected Tool Surface

| Tool/plugin surface | Useful for PAPZII | Current constraint | Cost/benefit |
| --- | --- | --- | --- |
| GitHub repo via `git` | Commit and push code/workflows to GitHub | Works for normal git push if local credentials remain valid | High benefit, low cost |
| GitHub connector | Actions logs/reruns, PR/repo inspection | Connector currently reports user not logged in; no secret-update tool exposed | High benefit once connected, low cost |
| Expo/EAS skills | EAS build, submit, TestFlight, Play Store release rules | Can configure repo files, but store submission needs valid env and credentials | High benefit, medium cost |
| Vercel connector | Web/admin previews or emergency stateless HTTP deployment | Not ideal for long-lived API, workers, NATS, MinIO, Typesense, OSRM | Medium benefit, low cost |
| Neon Postgres connector | Managed Postgres target | No PAPZII Neon project was found through available search evidence | High benefit, low cost if project exists |
| Supabase plugin | Migration reference and legacy schema audit | Free-plan rate limit makes it unsuitable as the live public backend | Medium benefit, low cost |
| Gmail plugin | Search emails for account/deployment evidence | Earlier Gmail tool call had a connector/tool-name mismatch | Medium benefit, low cost when callable |
| Codex Security | Security audit, threat model, hardening | Requires a stable deployed surface for final validation | High benefit, medium cost |
| Test Android Apps | Android emulator QA | Useful after API host is live and build installs | High benefit, medium cost |
| Browser/Chrome/Vercel verification | Visual and web flow verification | Mobile-native flows still need device/emulator builds | Medium benefit, low cost |
| YepCode | Custom remote scripts for one-off checks | Not a replacement for production hosting or secrets | Medium benefit, low cost |

## Problems And Fixes

| Problem | User impact | Best fix | Why this path | Cost/benefit |
| --- | --- | --- | --- | --- |
| `api.papzii.co.za` does not resolve | Every release build points to a dead API and times out on phone | Create an `api.papzii.co.za` A/CNAME record to the Dokploy/OCI public endpoint, then rerun `npm run validate:env:release` | Expo public env is baked into the binary at build time, so the host must be real before EAS builds | Very low cost, very high benefit |
| Dokploy deploy secrets are not confirmed in GitHub | Backend redeploy workflow skips or fails | Add `DOKPLOY_URL`, `DOKPLOY_API_KEY`, `DOKPLOY_COMPOSE_ID`, `DOKPLOY_API_HEALTH_URL`, optional `DOKPLOY_API_CONTRACT_URL` as GitHub repo secrets | GitHub Actions can build GHCR images, but Dokploy needs its own redeploy credentials | Low cost, very high benefit |
| GHCR pull may require auth | Dokploy cannot pull private images | Make GHCR packages public or configure a GitHub token in Dokploy registry settings | GHCR avoids Docker Hub and is supported by GitHub Actions | Low cost, high benefit |
| Nhost Auth/GraphQL/Functions hosts are unreachable | Sign-in/sign-up/feed/bookings fail behind FastAPI | Either fix Nhost service URLs/enabled services or move production data/auth to Neon + Keycloak behind FastAPI | The mobile app should not call Nhost directly; FastAPI can swap providers without another app rewrite | Medium cost, very high benefit |
| No live Postgres contract is proven | Bookings, profiles, feed, admin records may be missing columns | Configure `DATABASE_URL`/`NEON_DATABASE_URL`, apply migrations, require `/health/contract` to return `ok=true` | This catches missing columns like `bookings.is_instant` before users see failures | Medium cost, very high benefit |
| Four-role smoke tests are not live-passed | Client/model/photographer/admin flows may break asynchronously | Run live smoke tests only after API DNS and contract pass | Local structural audits cannot prove live auth, permissions, payments, push, or storage | Medium cost, high benefit |
| Public OSRM demo is used for routing | Maps can fall back to straight-line estimates if the demo API throttles/fails | Self-host OSRM for South Africa on OCI/Dokploy or use OpenRouteService for launch with a real key | Road geometry must come from routing, not haversine fallback | Medium cost, high benefit |
| Payments/media/notifications are still provider-dependent | Monetisation and records can fail even if UI loads | Keep PayFast/LiveKit/Expo Push/MinIO secrets on the server, then add smoke checks for each endpoint | Store binaries must not contain secret payment/media keys | Medium cost, high benefit |

## Release Decision

Do not submit another iOS or Android public build until all of these pass:

```bash
npm run validate:env:release
npm run audit:architecture
npm run audit:release-runtime
npm run typecheck
npm run lint
npx jest --runInBand --passWithNoTests
```

Then verify the live API manually:

```bash
curl https://api.papzii.co.za/health
curl https://api.papzii.co.za/health/contract
```

The correct next infrastructure move is not more frontend rebuilding. It is making the public API host real, wiring server-side env into Dokploy, and proving the database contract before EAS builds a new binary.

## Source Basis

- Dokploy supports Docker Registry deployments: https://docs.dokploy.com/docs/core/Docker
- Dokploy supports Docker Compose deployments: https://docs.dokploy.com/docs/core/docker-compose
- Dokploy documents GHCR registry setup: https://docs.dokploy.com/docs/core/registry/ghcr
- GitHub documents GHCR package permissions and image publishing: https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
- Expo documents EAS environment variables: https://docs.expo.dev/eas/environment-variables/
- Expo documents public Expo environment variables: https://docs.expo.dev/guides/environment-variables/
- Nhost documents service URL format: https://docs.nhost.io/platform/cloud/subdomain
- OSRM route geometry supports GeoJSON/overview settings: https://project-osrm.org/docs/v5.5.1/api/
