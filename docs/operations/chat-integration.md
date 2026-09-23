# Slide Chat integration

Speck Settings → Slide Chat lets an administrator create or revoke read-only
integration tokens. First assign machines to a named Site, create a token for that
Site, then enter its exact name and token in Slide Chat → Connections → Speck RMM
and select the corresponding Slide client. Tokens are displayed once and expire
after 30 days by default (maximum one year). Only their SHA-256 hashes are stored.

The integration exposes existing inventory/health, volumes, services, open alerts
and previously collected patch reports. It does not run scans, commands, file
operations or remote/recovery sessions. Device responses deliberately exclude
installation identities, remote credentials, previews, active app titles, users
and arbitrary telemetry. `last_seen`, `collected_at`, `scanned` and `available`
qualify freshness and missing data. Software inventory is not included.

Token authorization checks the exact current Site and archived state on every
request. Moving a device out of the Site removes access. A disabled or demoted
creating administrator invalidates their tokens. Tokens do not authenticate
against normal operator or agent endpoints; session cookies cannot substitute
for integration tokens. Creation/revocation use the normal admin session,
CSRF/origin protection and audit. Reads are limited to 120 requests per minute
per token, with 100 rows per page.

## API

Admin session routes:

- `GET /api/integrations/tokens`: non-secret token metadata and existing named Sites.
- `POST /api/integrations/tokens`: `{name, site, expires_days}`; one-time token response.
- `DELETE /api/integrations/tokens/{id}`: revoke immediately.

Send the token as `Authorization: Bearer <token>` only to these read routes:

- `GET /api/integrations/v1/devices?limit=100&after=<cursor>`
- `GET /api/integrations/v1/alerts?limit=100&after=<cursor>` (open alerts)
- `GET /api/integrations/v1/devices/{id}?category=detail|volumes|services|patches`

Collections return `next_cursor` (null on the last page). All responses identify
the exact `site`; consumers must retain their own client mapping and reject a
mismatched Site. The first version supports the hosted Speck origin in Slide Chat.

## Validation and release

Seven server regressions cover scope, pagination, secret exclusion, expiry,
revocation, creator roles, CSRF, token/session/agent isolation and rate limits.
Six new Chromium/WebKit cases cover desktop/mobile creation, one-time token display,
revocation and empty-site setup. All 90 browser scenarios, the complete backend
(120 tests), web units (28 tests), TypeScript/Vite build and Ruff pass locally.

Deployment requires the current main ancestor and a matching live baseline,
no active jobs/recoveries, a consistent private database and server/web backup,
then a backend restart. This is an additive table migration; existing devices,
accounts, secrets, settings, updater policy and recovery records remain unchanged.
Exact release and rollback evidence is retained privately under
`output/chat-integration/`; update the progress journal after live acceptance.


### September 23 rollout

Runtime `682fc0d` is deployed and pushed to main. HTTPS and public asset hashes
match the build; identity/account/MFA/provider/recovery/preview-policy/environment
invariants and SQLite integrity passed. No jobs, remote tunnels or recovery runs
were active at the restart. Rollback is
`/var/lib/speck-rollback/20260923T014640Z-chat-integration-682fc0d`.

Production acceptance through both public applications verified token creation,
scoped reads, Chat connection validation/save, companion inventory/alert/detail
reads, wrong-Site and wrong-client rejection, and revocation propagated through
Chat. The explicitly labeled temporary QA mapping, isolated Chat workspace,
companion credential and Speck integration access were removed/revoked afterward.
No customer mapping, Site assignments, endpoint commands or recovery changes were
made. Users configure their own Site/client connection through the two Settings
screens; unnamed machines must first be assigned to the appropriate Site.
