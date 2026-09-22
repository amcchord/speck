# Fleet operations upgrade

Branch: `codex/fleet-operations`, based on `443f17c`.

Implement a wide fleet table and right-side device drawer, direct remote/terminal
entry, per-device live screen previews, Windows/Linux patch management, bulk
software/script templates, and server-side OpenAI assistance. Preserve the minimal
Speck identity, source/restore separation and existing recovery evidence.

Live previews are opt-in, short-lived and disabled for new restored candidates.
Patch installs and template execution are explicit operator actions; no automatic
reboots or model-initiated commands. AI credentials stay server-side. Computer
assistance uses the displayed remote session with a reviewed next step.

Validate real agent capabilities, backend access boundaries, bulk idempotency,
Windows/Linux build/execution and desktop/mobile UI. Deploy to the existing
Speck host, update original lab agents, and publish source/screenshots. Preserve
rollback state in ignored output; do not patch unrelated lab applications.
