# PAPZII Open-Source Backend Architecture

This is the production architecture target for PAPZII. A release build is not public-ready until the app follows this boundary across all 44 screen modules.

## Runtime Stack

| Layer | Production choice | Purpose |
| --- | --- | --- |
| Mobile app | Expo / React Native | iOS, Android, web-compatible client |
| Public API boundary | FastAPI on Dokploy | All mobile auth, data, storage, and function calls |
| Auth | Nhost Auth or Keycloak behind FastAPI | Email/password, OAuth, session JWTs |
| Database API | FastAPI data/RPC/GraphQL proxy | Profiles, roles, bookings, feed, admin, records |
| Database | Nhost PostgreSQL or Neon PostgreSQL | Canonical source of truth |
| Storage | MinIO/S3 or Nhost Storage behind FastAPI | Avatars, portfolio, KYC, media assets |
| Backend functions | FastAPI `/functions/{name}` | Payments, dispatch, notifications, moderation, webhooks |
| Maps | MapLibre + OSRM | Open map rendering and road routing |
| Geocoding | Nominatim-compatible service | Address lookup and reverse geocoding |
| Search | Typesense | Fast discovery for models, photographers, agencies |
| Notifications | Expo Push via backend function | Booking, message, payment, review events |
| Payments | Backend payment adapter | PayFast/Ozow/Peach behind one service contract |

Supabase can remain as a local migration/reference adapter only. It must not be the active public backend for release builds while the free-plan rate limit is a known blocker. Nhost can remain behind the server, but the shipped mobile app should not call Nhost/Supabase provider SDKs directly.

## Non-Negotiable Boundary

Screens must not call vendor SDKs directly. All 44 screen modules must depend on contexts or domain services only:

- `src/store/*` owns app state and screen-facing actions.
- `src/services/*` owns domain operations such as booking, messaging, media, payment, routing, support, reviews, KYC, and admin.
- `src/config/*` owns provider clients and environment resolution.
- Provider SDKs such as `@nhost/nhost-js` or `@supabase/supabase-js` stay inside config/services adapters.

Direct `supabase.from(...)`, `supabase.channel(...)`, `supabase.storage...`, or function calls from `src/screens` and `src/components` are release blockers.

## Domain Services

| Domain | Service boundary | Production backend |
| --- | --- | --- |
| Auth/profile | `AppDataContext`, auth/profile repository | Nhost Auth + Hasura |
| Discovery/search | discovery repository | Typesense + Hasura profile snapshots |
| Booking | `bookingService` | FastAPI data/function endpoint |
| Dispatch/location | `dispatchService`, `routingService` | FastAPI function + OSRM |
| Messaging | `chatService`, `chatMessageService`, `MessagingContext` | Nhost function + Hasura subscriptions |
| Feed/timeline | feed repository | Hasura queries/mutations + Nhost Storage |
| Media/KYC | `uploadService`, `mediaService`, KYC repository | FastAPI storage + data records |
| Payments/payouts | `paymentService`, `monetisationService` | FastAPI payment functions |
| Admin/moderation | admin repository | FastAPI admin/moderation functions |
| Notifications | `notificationService` | Expo Push tokens + FastAPI notification function |

## Migration Order

1. Freeze public release builds until `npm run audit:architecture` passes.
2. Move direct screen/component Supabase calls into domain services.
3. Implement FastAPI-backed implementations for each domain service.
4. Make `EXPO_PUBLIC_BACKEND_PROVIDER=api` the only release provider.
5. Apply PostgreSQL schema, server permissions, storage buckets, and function env.
6. Run four-role smoke tests: client, photographer, model, admin.
7. Only then submit TestFlight / Play internal builds.

## Release Gate

The release gate is:

```bash
npm run validate:env:release
npm run audit:architecture
npm run check:launch
```

If this gate fails, the app is not ready for public TestFlight, Play internal testing, or store review.
