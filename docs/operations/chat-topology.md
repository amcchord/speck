# Read-only topology for Slide Chat

Settings → Slide Chat → Create integration token now offers optional Proxmox connection grants. A named-site token returns only guests uniquely matched to that site's endpoints and their parent hosts, so shared hypervisors do not disclose other clients' guests. Unassigned and unmatched guests are omitted. An all-sites token returns every host/guest in each selected connection. The site's endpoint telemetry remains restricted to that exact site. An explicit All sites (`*`) token is available for full-network overviews and must be connected to All clients in Chat.

Existing tokens gain no topology permission. Grants are stored on the token with its existing expiry, revocation, owner-role checks and rate limit. `/api/integrations/v1/topology` returns only the granted Proxmox connections, bounded inventory, safe identity fields, timestamps and stale/partial status. Unique hardware UUIDs can associate a resource with an endpoint inside the token's site; no out-of-site endpoint metadata is returned. Connection deletion removes its data. No credential, command, console, guest file, new scan or write operation is exposed.

The endpoint reuses the Fleet inventory cache, with its 60-second cache and last-successful fallback. Chat must disclose stale or unavailable providers rather than treating cached inventory as current. Slide protection and client ownership are joined in Chat using its own authorized Slide inventory.

Migration adds a default-empty topology_connections column to integration_tokens. Rollback can retain the current database: old code ignores the column, and old site filtering does not interpret all-sites tokens as broad access. Do not restore an older database over current endpoint activity.
