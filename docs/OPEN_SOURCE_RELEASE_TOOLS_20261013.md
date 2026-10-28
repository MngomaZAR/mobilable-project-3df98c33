# Tools used to close concrete release gaps

| Gap | Existing/proven tool | Work completed | Remaining evidence |
| --- | --- | --- | --- |
| Browser flows and layout | Playwright | Oracle all-role/workflow cases, fresh phone/tablet capture, and 24 live policy/web/HTTPS/CORS/asset checks passed | Browser results do not prove native UI |
| Native regression | Maestro | Added explicit authentication/tab test IDs and credential-free signed-in navigation flow, plus separately parameterized login flow | No Android device was attached; Maestro CLI is not installed here. Flows are prepared, not executed or accepted |
| Off-host database copy | Restic 0.19.1 | Fresh dump streamed into an encrypted private repository on the laptop; full read check, byte-for-byte retrieval and isolated PostgreSQL restoration/schema verification passed | Remote storage scheduling remains open; laptop custody is not unattended disaster recovery |
| Road geometry | Existing OSRM / MapLibre | Real route/tile/invalid-coordinate tests passed | Native gestures, denied permissions and poor-network device tests |
| Media service | Existing LiveKit | Existing authenticated booking-linked room/token/cleanup implementation retained | Real microphone/camera/remote media and TURN acceptance are not yet recorded |
| Financial operations | Existing PayFast / bank-payout adapter | 30/70 configuration and protocol checks retained; no invented acceptance | Owner confirmed no creator payout arrangement exists. Approved merchant/provider accounts, exact fee allocation, refund/chargeback rules and actual bank settlement are required |

## Native test scope

The new selector IDs require a new mobile binary; builds 42/5 do not contain them.
Use `.maestro/pilot-navigation.yaml` after manually signing in to an authorized
pilot account with completed age confirmation and no selected/active booking.
It performs read-only navigation,
a handle-targeted map gesture that must reveal the previously hidden location
control, and reopen persistence checks. Use the login flow separately with
private environment values; never commit passwords or share login screenshots.
Run each role on phone/tablet and both orientations, retaining device/build
metadata. A smoke flow cannot establish every feature or visual constraint.

Example for an already-installed Android candidate:

```sh
maestro test -e APP_ID=com.papziiii.paparazzi .maestro/pilot-navigation.yaml
```

## Payout decision

The owner's confirmed requirement is 30% platform / 70% creator, with processing
costs borne by the platform. The current software records completion-based
pending earnings and expects verified bank settlement before reporting paid out.
PayFast Split Payments instead splits at checkout and requires enabled accounts.
Do not substitute it silently for completion-based release, guess how fees are
allocated, or implement multiple-recipient splits unsupported by the provider.
Obtain the contracted arrangement and precise settlement/refund behaviour before
activating money flows. Open-source ledgers do not create banking authorization.

## Primary references

- Maestro: https://docs.maestro.dev/reference/commands-available/runflow
- React Navigation test selectors: https://reactnavigation.org/docs/bottom-tab-navigator/#tabbarbuttontestid
- Restic backup/check/restore: https://restic.readthedocs.io/en/stable/010_introduction.html
- PayFast split setup: https://support.payfast.help/portal/en/kb/articles/how-do-i-enable-split-payments-20-9-2022
- PayFast split fields: https://developers.payfast.co.za/docs/itn-instant-transaction-notification/
