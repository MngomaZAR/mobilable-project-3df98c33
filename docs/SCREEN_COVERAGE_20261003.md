# PAPZII Screen Coverage: 2026-10-03

**44 screen modules inventoried; 22 have browser entry-point evidence.** No physical iPhone/Android screen acceptance was performed in this pass. Agency/brand-specific journeys are not covered. Do not interpret static architecture checks or API tests as all-screen E2E coverage.

The final 27-case Playwright run uses the real isolated Oracle QA API: four roles at three viewports, new client registration/age declaration, phone settings entry points, interactive road maps and persistent chat. It captures 96 view-state screenshots. It checks navigation, page crashes, unexpected backend errors, map pixels/markers/geometry, message text bounds, horizontal overflow and tab-label bounds. It does not press every control. Synthetic fixtures do not prove real-world identities, money, users or videos.

All 27 cases passed again after Oracle pulled the published GHCR images for
source revision `291433aaa38af76f6bc8dd1bc7ce5c830c4a61e4`; exact report:
`qa-browser-ghcr-291433a.json`. This remains browser QA, not a store-device test.

| Screen module | UI evidence this pass | Domain evidence / remaining gap |
|---|---|---|
| AccessDeniedScreen | Not exercised | Static gate exists; rejection, blocked user and appeal UX need acceptance. |
| AccountConfigScreen | Browser entry: four roles, phone | Profile ownership tested by HTTP; actual edit/save/avatar and validation need UI tests. |
| AdminDashboardScreen | Browser: phone/tablet/desktop | Admin server authority tested; operational queues, incident actions and full analytics not accepted. |
| AdminModerationScreen | Not exercised | API KYC approve/reject and feed scopes tested; operator UI/actions and moderation lifecycle still open. |
| AgeVerificationScreen | Browser: fresh client declaration | Under-18/missing-terms denied by API; declaration is not independent identity verification. |
| AuthScreen | Browser: all four sign-ins + client signup | Atomic signup, invalid auth, refresh/reuse and reset/revocation protocol tests pass; actual recovery email is unconfigured and OAuth is hidden. |
| AvailabilityScreen | Not exercised | QA uses seeded weekly availability; persistence, editing and time-zone UI not accepted. |
| BookingDetailScreen | Not exercised | HTTP state/idempotency/conflict/payment guards tested; participant detail and full action buttons not accepted. |
| BookingFormScreen | Not exercised | Published provider/service/add-on quotes and stale-total rejection tested by API; equipment, service selection, rate/duration and final price still need full UI acceptance. |
| BookingTrackingScreen | Not exercised | Real OSRM API geometry tested; native map, live tracking and permission behavior not accepted. |
| BookingsScreen | Browser: all roles, all viewports | List/navigation only; no full create-to-review UI journey. Domain write journeys tested separately. |
| ChatScreen | Browser: phone/desktop persistent send/read and long text | HTTP retry/membership/private attachment/read/delete/react commands tested; full UI actions, native attachments and real-time transport not accepted. |
| ComplianceScreen | Browser entry: four roles, phone | Consent/age API evidence is partial; privacy control persistence and permissions need UI acceptance. |
| ConversationsListScreen | Browser: photographer/model/admin, all viewports | Inbox loads; client access path and full thread actions need UI acceptance. |
| CreatePostScreen | Not exercised | API inserts default pending moderation; media upload, caption, submit and errors need UI tests. |
| CreatePremiumBox | Not exercised | Digital monetization disabled in API store build; no successful creation/purchase test. |
| CreatorAnalyticsScreen | Not exercised | No accepted production recommendation/analytics pipeline or full chart validation. |
| CreatorSubscriptionsScreen | Not exercised | Digital features disabled; subscriber billing/IAP and lifecycle not proven. |
| CreditsWalletScreen | Not exercised | No real wallet purchase/settlement/IAP evidence; must not imply usable purchased credit. |
| EarningsDashboardScreen | Not exercised | Ledger summary has focused unit tests; actual ledger, payout and dispute UI not accepted. |
| EquipmentSetupScreen | Browser entry: photographer, phone | Initial 403 fixed. HTTP save/retry/owner protection/JSONB round-trip, tier synchronization and authoritative booking add-on prices pass. Save button interaction remains open. |
| FeedScreen | Browser: all roles, all viewports | Approved feed/like/ranking checks pass; stories, comments, reporting, block and media quality remain partial. |
| HomeScreen | Browser: client, all viewports | Discovery loads; search/filter/profile/booking buttons and geospatial accuracy need interaction tests. |
| KYCScreen | Browser entry: photographer/model, phone | Real MinIO upload of synthetic document/selfie, submission, admin approve/reject and private access tested by API only; native upload and identity operations remain open. |
| LegalScreen | Browser entry: four roles, phone, Terms/Privacy | Legal text/policy consistency and outgoing links require separate review; display is not legal approval. |
| MapScreen | Browser: eight map/route/failure cases on phone/desktop | Real tiles, WebGL canvas pixels, role markers, road geometry, bounds/snap validation and retry tested. No native map/GPS/traffic acceptance. |
| MediaLibraryScreen | Not exercised | Ownership/private gateway tests pass; persistent URLs, thumbnails, video processing and portfolio UX remain incomplete. |
| ModelPremiumDashboard | Browser: phone/tablet/desktop | Recorded earnings shown; fabricated fans/upgrade removed, disabled digital panels hidden. Availability and booking buttons need state/action tests. |
| ModelReleaseScreen | Not exercised | Contract table/API permissions and signature/legal lifecycle incomplete. |
| ModelServicesScreen | Browser entry: model, phone | Typed atomic replacement/save/retry/round-trip and published-rate quote tests pass; explicit services hidden and rejected by API. Save interaction and native service booking remain unaccepted. |
| NotificationsScreen | Not exercised | Durable outbox creates in-app records; read/clear/deep-link and physical-device push not accepted. |
| PaidVideoCallScreen | Not exercised; service unavailable | API returns 503; no rooms/tokens/media/payment/device or concurrency acceptance. |
| PaymentHistoryScreen | Browser entry: four roles, phone | Protocol tests write records in QA; receipt/refund details and real payment visibility need UI acceptance. |
| PaymentScreen | Not exercised; checkout unavailable in no-secret QA | 30 mock-gateway payment/tracking protocol checks are not a real checkout; actual gateway/return/ITN and interrupted payment UX remain blocked. |
| PayoutMethodsScreen | Browser entry: photographer/model, phone | No bank transfer execution/settlement. Stored method or pending request is not a successful payout. Add/edit/default actions not UI-accepted. |
| PendingVerificationScreen | Not exercised | API pending status exists; provider onboarding/refresh/rejection UI not accepted. |
| PhotographerDashboardScreen | Browser: phone/tablet/desktop | Ledger earnings replace unpaid-booking estimates; full accept/decline/availability actions not UI-tested. |
| PostDetailScreen | Not exercised | Parent visibility, comments, unlock/report and media actions require full permissions and UI tests. |
| ReviewsScreen | Browser entry: four roles, phone | Paid/completed client review and pending moderation tested by API; submit interaction and published rating aggregation not accepted. |
| RoleSelectionScreen | Not exercised | Role/profile creation tested by API; role choice and provider onboarding UI need acceptance. |
| SettingsScreen | Browser: all roles, all viewports | Sessions/revoke/sharing have focused unit evidence, not physical-device acceptance. Unsupported biometric/2FA/export controls are unavailable and English is readonly. Browser tests cover rendering/navigation, not every action. |
| SplashLoadingScreen | Transient only; not asserted | Startup timeout/error/network retry behavior needs explicit tests. Not counted as tested. |
| SupportScreen | Browser entry: four roles, phone | Ticket submission, attachments, admin response and SLA behavior need acceptance. |
| UserProfileScreen | Not exercised | Public profile privacy tested by API; profile/portfolio/reviews/book/chat controls and expiring media need acceptance. |

## Next Acceptance Batch

1. Finish missing domain APIs/operational configuration before testing their screens: contracts, media processing, actual recovery email, real payouts/refunds/video/dispatch and deletion processing. Published booking prices, atomic service replacement and media renewal have candidate API evidence, not full UI acceptance.
2. Exercise one real-device client/provider booking from signup through KYC, availability, server quote, actual payment, chat, delivery, settlement and review, with administrator incident/moderation actions.
3. Repeat with model, cancelled/refunded booking, double-booking race, network interruption, denied permissions and relaunch after session expiry.
4. Cover all remaining screen controls and accessibility, then run sustained concurrent traffic including real media infrastructure in an isolated environment.
5. Only then promote and create TestFlight/Play internal binaries; public review requires separate verified store metadata, compliance and physical-device evidence.

See [candidate follow-up](QA_CANDIDATE_FOLLOWUP_20261003.md) for the latest results and [historical QA report](QA_RELEASE_REPORT_20261003.md) for earlier failures. Public release remains blocked.
