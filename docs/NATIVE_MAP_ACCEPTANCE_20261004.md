# Native Map Follow-Up

The October 4 build-40 browser acceptance exposed separate native-map gaps.
These changes require a new binary; build 40 and Android code 3 do not contain
them. Public marketplace acceptance remains incomplete.

| Before | Candidate behavior |
| --- | --- |
| Map inserted an instant booking directly with local package pricing. | Map opens the canonical booking form, which loads provider verification and server-priced quotes. |
| Offline creators could not receive scheduled bookings. | Scheduled booking is available without presence or GPS; shoot location is selected in the form. |
| Model/photographer flow bypassed the validated service boundary. | Correct provider ID and service type are supplied to that boundary. |
| Direct-distance estimates were presented as driving ETA, including a default 15 minutes. | ETA appears only with validated road geometry and a positive router duration. |
| Old route responses could redraw a previously selected creator's path. | Destination-bound state hides previous geometry immediately; obsolete responses are ignored. |
| Network failure left stale lines without an actionable retry. | Route failure clears geometry and offers retry; direct distance is explicitly labeled. |
| Accepted bookings implied arrival and opened a made-up chat ID. | Exact booking details provide the existing participant-aware chat and tracking actions; acceptance does not imply travel. |
| Paid-out bookings could appear as active; schedules were labeled instant. | Terminal bookings are excluded and actual booking mode is displayed. |
| Native bottom sheet used whole-device height, not available map height. | Measured map height controls sheet placement and rotation constraints. |
| Map attribution was hidden. | Native map attribution is enabled. |

Focused tests cover stale requests, network failure, routing geometry/snap/metrics,
retry, provider identity, scheduling, account-gated instant entry, real booking
navigation and layout measurement. Browser canvas/tile checks do not prove native
map rendering. Physical iPhone/Android acceptance is still required.

No payment, payout, video or instant-dispatch acceptance was fabricated or enabled
globally. Full public submission remains gated on those integrations, physical
devices, all-role/all-control coverage, security and operational acceptance.
