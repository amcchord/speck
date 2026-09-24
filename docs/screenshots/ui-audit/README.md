# UI/UX audit result — September 23, 2026

Chromium captures at 1920 × 1080 from the synthetic fixtures served by
`scripts/preview.py`; no customer names, addresses or credentials. Digests are in
[manifest.json](manifest.json). The audit and its findings are in
[docs/ui-ux-audit.md](../../ui-ux-audit.md).

- [Fleet](fleet-1920.png) and [Alerts](alerts-1920.png): grouped navigation, inline header
  summaries, one icon refresh and page actions in the header.
- [Schedules](schedules-1920.png), [Patches](patches-1920.png),
  [Software & scripts](software-1920.png) and [Recovery lab](recovery-1920.png).
- [Activity](activity-1920.png) and [Job history](jobs-1920.png): full-height tables with
  readable event names.
- [Settings](settings-1920.png) packed into columns, and [Account & access](account-1920.png).

Infrastructure, Network & DNS, Keys and API & agents have no preview fixtures. Their
synthetic captures are in [../austinland](../austinland/README.md). Production captures,
before and after, stay in ignored `output/ui-audit/`.

Reproduce: `npm run build --prefix web`, then `python3 scripts/preview.py --port 8762` and
open `http://127.0.0.1:8762/#<page>` with the `speck-gallery=1` cookie at 1920 × 1080.
