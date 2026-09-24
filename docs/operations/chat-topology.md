# Read-only topology for Slide Chat

Settings → Slide Chat → Create integration token now offers optional Proxmox connection grants. A named-site token returns only guests uniquely matched to that site's endpoints and their parent hosts, so shared hypervisors do not disclose other clients' guests. Unassigned and unmatched guests are omitted. An all-sites token returns every host/guest in each selected connection. The site's endpoint telemetry remains restricted to that exact site. An explicit All sites (`*`) token is available for full-network overviews and must be connected to All clients in Chat.

Existing tokens gain no topology permission. Grants are stored on the token with its existing expiry, revocation, owner-role checks and rate limit. `/api/integrations/v1/topology` returns only the granted Proxmox connections, bounded inventory, safe identity fields, timestamps and stale/partial status. Unique hardware UUIDs can associate a resource with an endpoint inside the token's site; no out-of-site endpoint metadata is returned. Connection deletion removes its data. No credential, command, console, guest file, new scan or write operation is exposed.

The endpoint reuses the Fleet inventory cache, with its 60-second cache and last-successful fallback. Chat must disclose stale or unavailable providers rather than treating cached inventory as current. Slide protection and client ownership are joined in Chat using its own authorized Slide inventory.

Migration adds a default-empty topology_connections column to integration_tokens. Rollback can retain the current database: old code ignores the column, and old site filtering does not interpret all-sites tokens as broad access. Do not restore an older database over current endpoint activity.

## September 23 production release

Runtime `1e5404b` is live, preserving main `d6538cb` and the newer Proxmox preview runtime `84eb09e`. Release ownership was handed off after that task's live acceptance. Final local validation: 178 backend tests, 31 web units, Ruff and the TypeScript/Vite build passed. Endpoint/host binaries were unchanged.

The rollout re-audited every live backend file and the public index before activation, verified no active jobs/recovery/consoles, and retained server/web/configuration plus a consistent database snapshot. Existing accounts, credentials, identities, sites, Slide associations, settings, preferences, recoveries and integration grants retained their invariant hashes. Migration adds one default-empty grant column. Public health and asset hashes pass; unauthenticated topology access returns 401.

Live acceptance subsequently configured a five-endpoint client site from its exact existing Slide agent associations and issued two 30-day read-only tokens: one named-site/cluster token and one all-sites/two-cluster token. Chat successfully rendered both the client network and the full network. Broader data is rejected in client-scoped Chat conversations. No guest commands, power, restore, snapshot, console or endpoint installation operation ran.

Release: `/opt/speck/releases/20260923T142049Z-chat-topology-1e5404b`.
Guarded code rollback: `/var/lib/speck-rollback/20260923T142049Z-chat-topology-1e5404b/rollback.py`.
Check for active work and newer deployments first. Rollback keeps the current database, including subsequently configured tokens/sites and endpoint activity; old code ignores topology grants. Private deployment manifests and invariant checks are in the task worktree's ignored `output/chat-topology/`.
