# Policy publication and release hardening

The owner reopened the authorized Chrome hosting session. The Papzii cPanel
account identified `/home/papziico/public_html` as its document root. Six policy
directories were published without replacing a homepage or modifying other
projects. Each public URL returned HTTP 200 and the confirmed PAPZ operator.

- https://papzii.co.za/privacy/
- https://papzii.co.za/terms/
- https://papzii.co.za/creator-policy/
- https://papzii.co.za/model-release/
- https://papzii.co.za/community/
- https://papzii.co.za/cookie-policy/

Copy now explicitly describes the restricted pilot, removes unconfirmed
cancellation/admin fees, does not advertise adult-content areas, treats the
model release as a template requiring express agreement, and corrects privacy
complaint contact details. The support mailbox was verified present and
unrestricted in the same hosting account. This is not legal certification.

cPanel confirmed Force HTTPS enabled for Papzii. Nineteen live browser checks
passed across 320px/768px/1440px and HTTP redirect verification. The current
native builds 42/5 contain older bundled copy; a new mobile candidate is needed
for the updated copy and stable native test selectors.

The owner expressly confirmed that no creator payout arrangement has been made.
Checkout, refunds and creator bank settlement remain disabled/unaccepted.
Public store submission must not bypass this missing business/provider gate.
PayFast split-at-checkout is not automatically equivalent to the existing
completion-based payout flow.

Open-source tooling was reviewed through primary documentation. Restic 0.19.1
created an encrypted off-host snapshot and recovered it into an isolated
PostgreSQL database with schema and account counts verified. No plaintext dump
was written to the laptop, no production database was replaced, and the owned
restore clone was removed. Continuous independent remote storage still needs
configuration. Native Maestro flows are prepared, not executed: no Android
device is attached here and the Maestro CLI is not installed.

References: https://inforegulator.org.za/contact-us/;
https://restic.readthedocs.io/en/stable/010_introduction.html;
https://docs.maestro.dev/reference/commands-available/runflow;
https://support.payfast.help/portal/en/kb/articles/how-do-i-enable-split-payments-20-9-2022

## Branded web pilot

The restricted web app is now published at https://papzii.co.za/ using the
live API. The bundle was built with local dotenv loading disabled and explicitly
verified not to contain the localhost QA API target. API CORS permits the exact
branded HTTPS origin. Publishing does not enable financial services.

A real refresh check exposed missing SPA fallback: `/Root` initially returned
404. After inspecting hidden files and confirming no existing `.htaccess`, a
scoped fallback was added. Root/deep links now return the app shell; existing
policy/static paths are preserved, missing static assets remain 404, and `.mjs`
workers receive JavaScript MIME. The transient Chrome connection failure was
resolved by reconnecting the existing direct browser, without copying cookies,
creating an unrelated browser or modifying other projects.

The final live suite passed 24 checks: six policies at three sizes, four web
authentication viewport/reload checks, HTTP-to-HTTPS redirect and API-CORS/static
asset checks. This establishes the public web shell and policy deployment, not
authenticated production booking acceptance or native-device acceptance.
