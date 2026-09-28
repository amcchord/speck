# Entity navigation

## Plan

Make the same real-world object open the same inspector wherever it appears.
Reuse Speck's existing machine, infrastructure and network panes and browser
history. Ship this as a web-only change, preserving endpoint agents and providers.

| Concept | Identity and destination |
| --- | --- |
| Machine | Unified Fleet ID; its existing machine pane and selected tab |
| Hypervisor | Proxmox connection + node ID; canonical Fleet machine when available |
| Equipment | Console + site + device ID; equipment pane |
| Port | Equipment identity + physical port number; selected equipment port |
| Client | Existing customer membership key; member machines and providers |
| LAN client | Console + site + MAC; network observation pane |
| Network | Console + site + observed network name and VLAN; observed members |
| IP address | Address plus optional site scope; reporting machines, clients and routing evidence |
| Site / provider | Existing site or connection identity; current inspector |

1. Add typed entity references and one accessible link renderer, with consistent
   labels, focus treatment, copyable URLs and browser Back support.
2. Put explicit links in Fleet, machine identity/network facts, provider and
   network relationships. Canonicalize provider identities to Fleet IDs using
   exact resource membership. Do not join machines by hostname or IP.
3. Add customer, network and IP inspectors using existing read-only APIs. Keep
   customer clients distinct from LAN clients. Networks are observed groups,
   not claims of complete configured VLAN inventory. Ambiguous known names open a choice of exact resources; repeated IPs show evidence rather than pick a machine.
4. Reuse the same references in search and structured read-only detail facts.
   Keep commands, raw technical evidence, credential values and editable fields
   untouched. Preserve unknown/unavailable states and current permissions.
5. Test scoped identity collisions, special characters, reload/Back/tab/port
   navigation, viewer behavior and phone layouts in Chromium and WebKit; run all
   web units and browser checks. Review synthetic screenshots.
6. Fetch origin/main before each production build, verify its ancestry and the
   deployed source, hold the shared release lock, compare the live baseline
   immediately before publication, retain rollback, and verify served hashes,
   health and protected state with read-only live acceptance.

## Release ownership

This chat (`01a0e570-ee42-71d1-8e11-18f648f5371b`) is the single deployment
owner. The inspected task list contained no other active Speck task. Base
preserves main `db2f55b` plus newer deployed UX work through `43f19bd`
and its record `eff78eb`; inspected live index is
`fbeb87a3cdd6c16c3fdc2efc0f39755cf23b45fe16e1f7337768cdfb4a225e39`.
Private baseline and acceptance records stay in ignored `output/entity-navigation/`.

## Implemented contract

`entity-model.ts` defines the concepts, scopes and exact resource-to-machine
mapping. `entity-links.ts` renders real anchors (keyboard activation, browser
new-tab behavior and shared focus styling). Explicit references carry identity;
standalone known names in structured read-only facts use the bounded inventory
catalog. Ambiguous names open an exact-choice inspector. This does not create or
merge machine identities. Commands, editable fields, credential values, technical
payloads and arbitrary prose are not rewritten.

Fleet client, address and host cells; machine identity and network facts;
Infrastructure host/guest navigation; Proxmox host/IP facts; LAN network/uplink/
port relationships; schedule targets; and global search use these concepts.
Existing operational links retain their specific job, protection or management
inspector. Physical ports use the equipment pane's selected-port URL; protocol
ports mentioned in command output are not physical ports. Unreported networks or
uplinks remain plain text. Client membership reflects provider customer keys;
reviewed Customers & sites workspaces retain their separate explicit associations.

Client, observed-network and IP inspectors have searchable, bounded lists, scoped
related links, unavailable/empty states and retry. IPv4 and IPv6 share the address
inspector. Private IPs can report multiple machines and never choose an owner.
Site-scoped addresses require site/MAC evidence for a machine relationship. Network
views describe observed name/VLAN membership, not configured subnet discovery.
All reads use existing permissions and session caching; no new credentials or
backend API is required. Viewer address inspection avoids privileged network reads.

History retains workspace context. Copy links retain the selected machine tab
or equipment port; normal hops offer Back, while modified clicks retain native
browser behavior. A navigation checkpoint prevents a late response from replacing
the inspector chosen afterward. Logout clears the catalog with existing caches.
