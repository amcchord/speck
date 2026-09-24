# AustinLand in Speck

Speck now does what the localhost AustinLand panel did, from anywhere, behind
Speck's own sign-in, roles and audit history. Sign in as an administrator
(for example `austin`) to see and manage all of it.

| AustinLand | Speck | API |
| --- | --- | --- |
| Key vault and arbiter | **Keys → Vault** | `/api/keys` |
| `.env` provider credentials | **Keys → Providers** | `/api/keys/services` |
| SSH keys | **Keys → SSH keys** | `/api/ssh` |
| LLMContextAccess files | **Keys → Handoffs** | `/api/context` |
| GoDaddy DNS | **Network & DNS → Domains** | `/api/dns` |
| UniFi public IPs and NAT | **Network & DNS → Public IPs** | `/api/unifi` |
| LAN clients, UniFi consoles | **Network & DNS** tabs | `/api/unifi/clients`, `/api/unifi/consoles` |
| Linode and Proxmox VMs | **Fleet**, **Infrastructure** (already native) | `/api/fleet`, `/api/infrastructure` |
| `agents.md`, `austinland.md` | `/agents.md`, `/speck.md`, `/llms.txt`, **API & agents** | `/api/openapi.json`, `/mcp` |

The endpoint shapes for keys, DNS, public IPs and SSH keys deliberately match
AustinLand's, so an agent that knew AustinLand only needs Speck's URL and a token.
Speck adds unified search, a reachability map and an MCP server.

## How each provider is reached

- **GoDaddy**: direct HTTPS from the Speck server. Every call passes one token
  bucket at 55 requests per minute (GoDaddy allows about 60). Domains and zones
  are cached durably; `POST /api/dns/scan` refreshes stale zones in the background.
  Writes return the refreshed zone.
- **UniFi**: Site Manager's cloud connector
  (`api.ui.com/v1/connector/consoles/{id}/proxy/network/...`) reaches the gateway's
  local Network application, including the session and v2 NAT APIs. No LAN route,
  VPN or port forward to the control plane is needed. `UNIFI_GATEWAY` (a LAN IP or
  console ID) selects the managed gateway. Mapping an IP creates the same two rules
  AustinLand did — an all-ports forward (except 500/4500) and a v2 SNAT rule — named
  `Speck: <name>`. Only `free` addresses can be mapped; rules Speck did not create,
  including Lucea World's, are shown as `in_use` and never modified.
- **OpenAI / Twilio**: provisioning mints a project-scoped key (OpenAI project +
  service account, Twilio API key) and deleting the entry revokes it upstream.
  **Anthropic / App Store Connect** keys are shared and each recipient project is recorded.
- **Linode**: SSH-key registration uses the existing Infrastructure Linode connection.

**Check** on a provider card makes one read-only request (list projects, models,
consoles, apps or domains) and never mints or changes anything.

## Reachability

`GET /api/network/map` joins evidence Speck already holds, never names:
endpoint-agent and provider addresses; Proxmox guest NIC MACs matched exactly to
UniFi client MACs (giving LAN IPs for VMs without a guest agent); public IP
mappings; and cached DNS records. The Public IPs, Domains and Reachability views
use it to show which machine each address and hostname reaches.

API-token Proxmox connections now read each guest's config (cached for ten
minutes) for the same UUID/MAC/guest-agent identity the host connector reports.

## Security model

- Vault entries, provider credentials, SSH private keys and handoff files are sealed
  with `SPECK_ENCRYPTION_KEY` (Fernet). Provider credentials are write-only: Speck
  shows masked hints (first and last four characters) and never returns them.
- The vault, handoffs and SSH private keys are for administrators. Every reveal,
  `.env` export, handoff read and private-key read is audited by name, never value.
  The console holds revealed values for 90 seconds and clears them on close.
- **API tokens** (`speck_pat_…`, shown once, stored as SHA-256) act as their creator
  and never exceed the creator's current role. `read` allows GET requests, `operate`
  caps at operator, `admin` allows administrator writes; `keys:read` / `keys:write`
  gate the vault independently and can be limited to entry-name prefixes. Tokens
  cannot sign in, manage accounts, passkeys or tokens, or open interactive remote or
  console sessions. They skip cookie CSRF checks because browsers never send them
  ambiently. 600 requests per minute per token. Activity shows token use as
  `owner (API: token name)`.
- **MCP** (`POST /mcp`, streamable HTTP, stateless JSON) re-dispatches each tool call
  to the matching REST endpoint in-process with the caller's own token, so it cannot
  widen scopes, roles, rate limits or audit attribution. Requests with a foreign
  `Origin` are rejected.

Moving the vault from a localhost-only Mac to an Internet-facing server widens who
could reach it if an administrator session or `keys:*` token leaked. Keep admin
accounts on passkeys or authenticator codes, issue narrow tokens with prefixes and
short expiry, and revoke tokens you no longer use.

## Migration from AustinLand

`scripts/import_austinland.py` reads (never modifies) the AustinLand checkout and
`~/.ssh/*.pub`, then imports through the API with an administrator token holding
`admin`, `keys:read` and `keys:write`:

```sh
uv run python scripts/import_austinland.py --dry-run          # counts only, no values
SPECK_URL=https://speckrmm.com SPECK_TOKEN=speck_pat_… \
  uv run python scripts/import_austinland.py
```

It copies provider credentials, vault entries (keeping minted-key metadata so
revocation still works), AustinLand's remaining LAN credentials as one static entry,
the GoDaddy domain/zone cache, the ten AustinLand public IP mappings, handoff files
and SSH public keys. Existing Speck entries are never overwritten; re-running is safe.

Deliberately **not** imported:

- `speck-rmm` and `speck-agent-release-signing`: Speck's own deployment secrets and
  the endpoint-update signing key must not live inside the system they protect.
  They stay in AustinLand (use `--include-speck-secrets` only if you accept that).
- Private halves of `~/.ssh` keys: only public keys are imported. Handoff files still
  carry their own dedicated keys.
- AustinLand's `secrets/` directory.

AustinLand keeps running unchanged, so existing repositories that call
`localhost:8472` still work while they move to Speck.

A token for the import can be created on the server host without a browser:

```sh
cd / && (set -a; . /etc/speck/server.env; PYTHONPATH=/opt/speck/server
  runuser -p -u speck -- /opt/speck/.venv/bin/python -m speck.api_tokens --username austin \
    --name "AustinLand import" --scopes read,admin,keys:read,keys:write --days 1)
```

It prints the token once and records `host:austin` in Activity. Revoke it afterwards
with `--revoke <id>` or from **API & agents**.

## Launching VMs

**Infrastructure → New VM** and `POST /api/vms` create a Proxmox guest from the Debian 13
cloud-init or Windows 11 template through the AustinLand bridge operation `proxmox-create`
(automatic placement, resize, first-boot setup). Speck resolves SSH key names, generates an
administrator password and saves it as vault entry `<name>-admin`, then follows the VM until
UniFi reports its DHCP lease and offers to map a free public IP. `GET /api/vms/{name}` and
`/handoff` report state, LAN/public addresses, hostnames and the credential's vault name.
The password never appears in audit history or the infrastructure receipt.

This path still depends on the AustinLand bridge worker on the Mac. Running it natively
through the Proxmox host connector would require adding cloud-init configuration, disk
resize, task-status and guest-password calls to the connector's fixed allowlist; that change
widens what a compromised control plane could ask the hosts to do and has not been made.

## Not yet native

- Generating new SSH-key handoffs that install a dedicated key on the machine. Imported
  handoffs can be read, copied and deleted; `GET /api/vms/{name}/handoff` gives a
  credential-free handoff for launched VMs.

## September 23 production release

Deployed from `claude/austinland-integration` with the backed-up release procedure
(current-main ancestry, live-hash baseline, consistent SQLite snapshot, invariant checks
for identities, accounts, settings, integrations, recovery and environment, automatic
rollback on failure). No endpoint agent, host connector or provider configuration changed.

| Release | Commit | Rollback |
| --- | --- | --- |
| Vault, DNS, UniFi, SSH, handoffs, tokens, MCP, pages | `9b69a9d` | `/var/lib/speck-rollback/20260924T000529Z-austinland-integration-9b69a9d` |
| New VM, reach-aware search, Fleet reach, phone cards | `0c6c35e` | `/var/lib/speck-rollback/20260924T002457Z-austinland-integration-0c6c35e` |
| Free public IP counts in `/api/overview` | `5f9cfd2` | `/var/lib/speck-rollback/20260924T003058Z-austinland-integration-5f9cfd2` |

Each release passed `./scripts/check-local.sh core` first (the second: 203 backend tests,
Linux agent and connector race tests, all platform builds, web units and 207
Chromium/WebKit scenarios with one existing platform skip). The Chat integration spec
was updated to match the already-deployed topology behavior; its failure predated this work.

Migration used a one-day host token (`host:austin` in Activity), revoked immediately
after: 5 provider credentials, 43 vault entries, 286 domains, 271 cached zones, 10 public
IP mappings, 6 handoffs and 13 SSH public keys. `speck-rmm` and
`speck-agent-release-signing` stayed in AustinLand.

Live acceptance, all read-only against providers:

- Every provider credential passed **Check** from the Linode: OpenAI (15 projects),
  Anthropic (12 models), Twilio (active), GoDaddy, UniFi (21 consoles through the cloud
  connector) and App Store Connect (9 apps).
- The public IP pool matched the gateway: 9 free, 10 Speck-managed (ex-AustinLand),
  8 other rules (Lucea World and pre-existing forwards, untouched) and the gateway address.
- The network map traced 109 machines, 53 LAN IPs by exact UniFi MAC match, 14 NAT paths
  and 29 machines reachable by hostname; for example `auth.slide.wtf` → 160.72.186.103 →
  `austinland-auth` 192.168.110.10.
- Chromium desktop and WebKit phone captured every new page with production data; the
  New VM dialog loaded real templates and node capacity (not submitted).
- A real Claude Code session connected to `https://speckrmm.com/mcp` with a read-only
  token and answered from `speck_overview`, `speck_search`, `key_services` and
  `vm_options`; a write tool call from that token was refused.
- A background GoDaddy zone refresh was started from the console (GET requests only).

Browser acceptance used a disposable administrator (`qa-austinland-browser`), disabled with
its sessions removed afterwards. All temporary API tokens are revoked. No DNS record, NAT
rule, VM, key mint, Linode key or endpoint changed.

Not exercised live: DNS writes, public IP mapping/removal, key minting/revocation, Linode
key registration and VM creation. These have exact-request tests with mocked providers and
browser tests with synthetic data; exercise them deliberately on disposable resources.

Rollback: stop `speck`, restore `server/` and `web/` from the rollback directory, start
`speck`. The new tables are additive and unused by older code; keep the current database
so vault and cache contents remain available for a later redeploy.
