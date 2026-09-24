# Phone and tablet redesign — September 24, 2026

WebKit captures from the synthetic fixtures served by `scripts/preview.py`
(`scripts/preview_fixtures.py` supplies infrastructure, DNS, UniFi, keys and API data);
no customer names, addresses or credentials. Digests are in [manifest.json](manifest.json).
Findings and design: [docs/ui-ux-audit-mobile.md](../../ui-ux-audit-mobile.md).

**Phone** (iPhone 15, 393 × 659):

- [Fleet](phone-fleet.png) with the bottom tab bar and two-line machine rows.
- [More sheet](phone-more-sheet.png) with every page, grouped, plus account and sign-out.
- [Machine pane](phone-machine.png): one line of identity, then actions and pinned tabs.
- [Alerts](phone-alerts.png) with the "More actions" button, and [a dialog as a bottom sheet](phone-sheet-dialog.png).
- [Infrastructure with filters open](phone-infrastructure-filters.png), [Keys](phone-keys.png),
  [Network & DNS](phone-network.png) and [Job history](phone-jobs.png) as list rows.

**Tablet portrait** (iPad Pro 11", 834 × 1194): [Fleet](tablet-fleet.png),
[Keys](tablet-keys.png) and [Patches](tablet-patches.png) with the labelled rail.

**Tablet landscape** (1194 × 834): [Fleet](landscape-fleet.png) and [Patches](landscape-patches.png)
keep tables. The sidebar scrolls instead of clipping, and header actions stay on one row.

Production captures, before and after, stay in ignored `output/ui-audit-mobile/`.
Reproduce: `npm run build --prefix web`, then `python3 scripts/preview.py --port 8763`, and
capture with the `speck-gallery=1` cookie using Playwright's `iPhone 15` and `iPad Pro 11` profiles.
