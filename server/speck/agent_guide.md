# Speck — guide for LLM agents

Speck ({{ORIGIN}}) is Austin's RMM and infrastructure control plane. Through one
authenticated API you can find machines and run commands on them, manage Proxmox,
Linode and Slide infrastructure, edit GoDaddy DNS for ~270 domains, map UniFi public
IPs to LAN hosts, fetch SSH public keys, and get API keys for your project from an
encrypted vault. It replaces the old localhost AustinLand panel; the endpoint shapes
for DNS, public IPs, SSH keys and the key vault are intentionally the same.

## Authenticate

Every call needs a personal API token created by a human in **Speck → API**:

```bash
export SPECK_URL={{ORIGIN}}
export SPECK_TOKEN=speck_pat_...        # from the human or your secret store; never commit it
curl -s -H "Authorization: Bearer $SPECK_TOKEN" $SPECK_URL/api/whoami
```

A token acts as the person who created it and never exceeds their role. Scopes:

| Scope | Allows |
| --- | --- |
| `read` | Every GET the creator can make: fleet, infrastructure, DNS, public IPs, audit |
| `operate` | Operator changes: endpoint jobs/commands, file listings, provider reads |
| `admin` | Administrator changes: DNS writes, public IP mapping, infrastructure actions |
| `keys:read` | List vault entries and reveal secret values (audited) |
| `keys:write` | Provision, store, update and delete vault entries |

Tokens can be limited to vault entry name prefixes (for example `Lucea` for a
Lucea-only agent). Tokens cannot sign in, manage tokens or accounts, or open
interactive remote/console sessions. Errors are JSON `{"detail": ...}` with a 4xx/5xx
status; 401 means the token is invalid/expired/revoked, 403 means a missing scope or role.
Requests are rate limited to 600 per minute per token.

Machine-readable schema: `GET /api/openapi.json`. Orientation: `GET /api/overview`.

## MCP

Speck is also an MCP server (streamable HTTP, stateless JSON). With Claude Code:

```bash
claude mcp add --transport http speck {{ORIGIN}}/mcp --header "Authorization: Bearer $SPECK_TOKEN"
```

Tools cover overview/search, machines and commands, DNS, public IPs, SSH keys, the
vault and handoff documents; `speck_api` calls any REST endpoint with your token.

## Find anything

```bash
curl -s -H "Authorization: Bearer $SPECK_TOKEN" "$SPECK_URL/api/search?q=97.107.140.55"
curl -s -H "Authorization: Bearer $SPECK_TOKEN" "$SPECK_URL/api/search?q=lucea"
```

Search spans machines (names, aliases, IPs), provider resources, domains and cached DNS
records, public IP mappings, SSH keys and — for vault readers — vault entry names.
Each result includes the API call that returns its details.

## API keys for your project (the vault)

```bash
# Mint or share a key for this project. Idempotent: asking again returns the same entry.
curl -s -X POST $SPECK_URL/api/keys/provision -H "Authorization: Bearer $SPECK_TOKEN" \
  -H 'Content-Type: application/json' -d '{"service":"openai","project":"<repo-name>"}'

# Write an entry's secrets straight into a gitignored .env
curl -s $SPECK_URL/api/keys/<repo-name>-openai/env -H "Authorization: Bearer $SPECK_TOKEN" >> .env
```

| Endpoint | Purpose |
| --- | --- |
| `GET /api/keys/services` | Arbiter providers: `openai`, `twilio` mint project keys; `anthropic`, `app-store-connect` share one tracked key |
| `POST /api/keys/provision` | `{"service","project"}` → `entry.secrets` maps env var names to values |
| `GET /api/keys` | Entries with masked hints (`?q=`, `?service=`, `?project=`) |
| `GET /api/keys/{name}` | Full entry with secret values (audited) |
| `GET /api/keys/{name}/env` | The same values as `.env` lines |
| `POST /api/keys/static` | Store any credential: `{"name","service","project","notes","secrets":{ENV:value}}` or `{"name","value"}` |
| `PUT /api/keys/{name}` | Merge secrets (`null` removes one), edit notes/service/project |
| `DELETE /api/keys/{name}` | Remove; minted keys are revoked upstream unless `?revoke=false` |

App Store Connect returns `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID` and
`APP_STORE_CONNECT_PRIVATE_KEY` (the .p8). Keep private keys in memory or a mode-600
temporary file. Use the real repository name as `project` so the human can audit and
revoke per project. Do not delete entries you did not create.

## Machines and commands

| Endpoint | Purpose |
| --- | --- |
| `GET /api/fleet` | Unified machines: Speck endpoint agents joined to Proxmox, Linode and Slide resources |
| `GET /api/devices` | Enrolled Windows/Linux endpoint agents with telemetry |
| `POST /api/devices/{id}/jobs` | `{"kind":"command","payload":{"script":"...","shell":"auto|sh|powershell"},"timeout":60}` |
| `GET /api/jobs/{job_id}` | Poll until `status` is `succeeded`, `failed`, `expired` or `unknown` |
| `GET /api/alerts` | Open monitoring alerts |

Commands run as SYSTEM/root on real machines. Prefer read-only diagnostics, show the
human anything destructive first, and never retry a job whose outcome is `unknown`
without checking its effects.

## Infrastructure

| Endpoint | Purpose |
| --- | --- |
| `GET /api/infrastructure/inventory` | Resources per connection (Proxmox hosts/VMs/containers, Linode instances, Slide boxes/VMs) |
| `GET /api/infrastructure/connections/{id}/resources/{kind}/{rid}` | Resource detail; Proxmox adds status, config and tasks |
| `GET /api/infrastructure/connections/{id}/catalog?kind=qemu` | Available operations and their fields |
| `POST /api/infrastructure/connections/{id}/actions` | `{"request_id": uuid4, "kind", "resource_id", "operation", "args", "confirmation": "<exact target name>"}` |

Writes require an exact target-name confirmation and a fresh `request_id`; retrying the
same request ID returns the original receipt instead of repeating the change. Proxmox
templates (VM IDs 9000/9001) are protected. Deleting a VM is permanent.

## DNS (GoDaddy)

| Endpoint | Purpose |
| --- | --- |
| `GET /api/dns/domains` | Active domains (cached; `?refresh=true`, `?q=`) |
| `GET /api/dns/domains/{domain}/records` | Live records (refreshes the cache); `?cached=true` avoids a GoDaddy call |
| `POST /api/dns/domains/{domain}/point` | `{"name":"@"|"sub","ip":"1.2.3.4"}` sets/replaces the A record |
| `POST /api/dns/disconnect` | `{"domain","name","ip"}` removes one A value |
| `POST /api/dns/domains/{domain}/records` | Append `{"type","name","data","ttl","priority"}` |
| `PUT /api/dns/domains/{domain}/records/{type}/{name}` | Replace a record set: `{"records":[...]}` |
| `DELETE /api/dns/domains/{domain}/records/{type}/{name}` | Delete a record set |
| `GET /api/dns/connections` | IP → DNS names pointing at it (cached zones) |
| `GET /api/dns/linked` | Names pointing at Linode instances or mapped public IPs |
| `GET /api/dns/search?q=` | Records by hostname or value |
| `POST /api/dns/scan` / `GET /api/dns/scan` | Refresh cached zones in the background |

GoDaddy allows ~60 requests/minute; Speck queues calls at 55/minute. Prefer cached reads
and never loop over hundreds of zones yourself. Writes return the refreshed zone. TTL
minimum is 600 seconds.

## Public IPs (UniFi, 50 Day Street)

Proxmox VMs live on the LAN (192.168.96.0/20). To make one reachable from the Internet,
map a free public IP to it: all TCP/UDP ports except 500/4500 are forwarded and its
outbound traffic leaves from that IP. The host's own firewall is the only guard.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/unifi/pool` | Every public IP: `free`, `assigned` (Speck-managed), `in_use` (other rules), `gateway` |
| `GET /api/unifi/exposures` | Speck-managed mappings (public IP → LAN IP) |
| `POST /api/unifi/expose` | `{"public_ip","lan_ip","name"}` — only `free` addresses are accepted |
| `POST /api/unifi/unexpose` | `{"public_ip"}` — removes a Speck-managed mapping |
| `GET /api/unifi/clients` | LAN clients (name, IP, MAC) |
| `GET /api/unifi/consoles` | Every UniFi console on the account |
| `GET /api/unifi/status` | Gateway reachability through UniFi's cloud connector |

Never remove a mapping you did not create in this task: live DNS may point at it.

## SSH keys

| Endpoint | Purpose |
| --- | --- |
| `GET /api/ssh/keys` | Public keys (for `authorized_keys`), fingerprints, Linode registration |
| `POST /api/ssh/generate` | `{"name","comment","purpose"}` — Ed25519; the private half stays sealed in Speck |
| `GET /api/ssh/keys/{name}/private` | Private key (administrator + `keys:read`; audited) |
| `POST /api/ssh/register` | `{"name","label"}` adds a stored key to the Linode account |

## Handoff documents

`GET /api/context/files` lists machine handoffs (SSH access, DNS wiring and a system
snapshot for one machine). `GET /api/context/files/{filename}` returns the Markdown; it
embeds a private key, so it needs `keys:read` and is audited.

## Recipe: an internet-facing server with a domain

1. `GET /api/ssh/keys` — pick a `public_key` for the new machine.
2. Create the machine (Proxmox from a template, or Linode via the infrastructure catalog)
   and wait until it reports an address.
3. `GET /api/unifi/pool` — choose a `free` IP; `POST /api/unifi/expose` with the VM's LAN IP.
4. `POST /api/dns/domains/{domain}/point` with that public IP.
5. SSH in and build. Store any credentials you create with `POST /api/keys/static`.

## Safety rules

- Changes hit live systems. Confirm with the human before deleting anything or touching
  resources you did not create in this task.
- Only assign `free` public IPs. Leave `in_use` and `gateway` addresses alone.
- Keep secrets out of logs, commits, transcripts and screenshots.
- A 5xx on a write may mean it happened: read state before retrying.
- Do not create Windows VMs speculatively (each uses ~64 GB).
