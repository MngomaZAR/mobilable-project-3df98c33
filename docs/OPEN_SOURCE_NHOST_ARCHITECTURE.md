# PAPZII Open-Source Backend Architecture

This is the production architecture target for PAPZII. A release build is not public-ready until the app follows this boundary across all 44 screen modules.

## Runtime Stack

| Layer | Production choice | Purpose |
| --- | --- | --- |
| Mobile app | Expo / React Native | iOS, Android, web-compatible client |
| Auth | Nhost Auth | Email/password, OAuth, session JWTs |
| Database API | Nhost Hasura GraphQL | Profiles, roles, bookings, feed, admin, records |
| Database | Nhost PostgreSQL | Canonical source of truth |
| Storage | Nhost Storage | Avatars, portfolio, KYC, media assets |
| Backend functions | Nhost Functions | Payments, dispatch, notifications, moderation, webhooks |
| Maps | MapLibre + OSRM | Open map rendering and road routing |
| Geocoding | Nominatim-compatible service | Address lookup and reverse geocoding |
| Search | Typesense | Fast discovery for models, photographers, agencies |
| Notifications | Expo Push via backend function | Booking, message, payment, review events |
| Payments | Backend payment adapter | PayFast/Ozow/Peach behind one service contract |

Supabase can remain as a local migration/reference adapter only. It must not be the active public backend for release builds while the free-plan rate limit is a known blocker.

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
| Booking | `bookingService` | Nhost function + Hasura mutation |
| Dispatch/location | `dispatchService`, `routingService` | Nhost function + OSRM |
| Messaging | `chatService`, `chatMessageService`, `MessagingContext` | Nhost function + Hasura subscriptions |
| Feed/timeline | feed repository | Hasura queries/mutations + Nhost Storage |
| Media/KYC | `uploadService`, `mediaService`, KYC repository | Nhost Storage + Hasura records |
| Payments/payouts | `paymentService`, `monetisationService` | Nhost payment functions |
| Admin/moderation | admin repository | Hasura admin role + Nhost functions |
| Notifications | `notificationService` | Expo Push tokens + Nhost notification function |

## Migration Order

1. Freeze public release builds until `npm run audit:architecture` passes.
2. Move direct screen/component Supabase calls into domain services.
3. Implement Nhost/Hasura implementations for each domain service.
4. Make `EXPO_PUBLIC_BACKEND_PROVIDER=nhost` the only release provider.
5. Apply Nhost PostgreSQL schema, Hasura permissions, storage buckets, and function env.
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
