# Phone and tablet UI/UX audit — September 24, 2026

The desktop audit ([ui-ux-audit.md](ui-ux-audit.md)) grouped navigation, unified page headers
and compacted dense views. This follow-up applies the same review to touch devices.
Every page, tab, machine pane and primary dialog was captured in WebKit against production
(release `233a434`, 240 machines, 281 infrastructure resources, 286 domains, 684 LAN
clients, 43 vault entries) at three sizes:

| Profile | Viewport (CSS px) | Represents |
| --- | --- | --- |
| Phone | 393 × 659 | iPhone 15 Safari (visible area), touch |
| Tablet portrait | 834 × 1194 | iPad Pro 11" / iPad Air, touch |
| Tablet landscape | 1194 × 834 | iPad landscape, small laptops |

Captures with customer names stay in ignored `output/ui-audit-mobile/before/`. No page
scrolled sideways and no page raised a script error. The same goal applies: **powerful,
simple, clean**. On a phone that means the first screen shows content, not chrome.

## Phone findings

| # | Finding | Evidence |
| --- | --- | --- |
| P1 | Navigation is the desktop sidebar squeezed into a 230 px top block: brand, account and a sideways-scrolling strip of 15 buttons. The current page is often off-screen in the strip. | Every page |
| P2 | The first screen is chrome. Title, a wrapped summary, a two-line description, a refresh button alone on its own row, tabs and a two-column filter grid come before the first row. On Keys, Network and Infrastructure, content starts more than a full screen down. | Keys, Network, Infrastructure, Activity |
| P3 | Tables are squeezed rather than redesigned. Columns are cut off, and the Keys vault rows reach 300 px because service names wrap per syllable. Patches hides Review off-screen, and Job history breaks "command" into "comma / nd". Account & access clips Status and Manage. | Keys, Patches, Jobs, Activity, Account, Infrastructure activity, Recovery evidence |
| P4 | Where tables do become cards, every cell gets an uppercase label and its own line. A Fleet machine is about 600 px tall (240 machines = 16,200 px) and a domain is about 290 px (286 domains = 18,000 px). Placeholder rows ("Active app —", "Attention —") take as much room as data. | Fleet, Domains, Public IPs |
| P5 | The machine pane repeats about 1,000 px of identity (client, agent, location, join evidence, full-width resource buttons, IP, OS, uptime, last report) above the tabs on every tab. Opening Services shows only the filter field on the first screen. | Machine pane |
| P6 | Filters sit in a two-column grid of full-size selects, with truncated search placeholders ("Name, host, IP or"). Activity's six filter controls take the whole first screen, and "Export JSON" wraps to "Expor / t / JSON". | Infrastructure, Network, Keys, Activity |
| P7 | Dialogs float as cards with margins, and the close button is 56 px with a heavy focus ring. They read as desktop modals rather than sheets. | Schedule editor, New VM, Add device |
| P8 | Buttons in panes wrap into ragged rows (Delete alone on its own line), and resource links render as full-width buttons. | Keys entry, domain pane, machine pane |

## Tablet findings

| # | Finding | Evidence |
| --- | --- | --- |
| T1 | The 204 px sidebar takes a quarter of a portrait tablet, leaving about 580 px. Tables overflow or wrap: Keys secret names break every 10 characters, and Fleet cuts off at the Speck agent column. | Portrait: Fleet, Keys, Infrastructure |
| T2 | Header actions stack vertically beside the title, and labels wrap ("Monitoring / policy", "Scan / selected"). | Alerts, Patches, Infrastructure, Keys |
| T3 | **Bug:** Patches' Review button renders one letter per line. | Portrait Patches |
| T4 | **Bug:** on an 834 px-tall screen the sidebar clips Settings and Downloads, so they cannot be reached. | Landscape, small laptops |
| T5 | **Bug:** on touch screens the Fleet selection column truncates its checkbox to "…". | Portrait and landscape Fleet |
| T6 | The machine pane leaves a 100 px sliver of the sidebar visible, which reads as a layout glitch. | Portrait machine pane |

## Shared bug

| # | Finding |
| --- | --- |
| B1 | Closing the New VM dialog while it is still loading, then navigating, shows a red "This view is no longer active" toast. The internal stale-view signal leaks to people. Several other error handlers have the same gap. |

## Design

**Breakpoints.** Phone ≤ 760 px, tablet 761–1100 px, desktop above. Tables switch to list
rows by the width available to them (a container query at 720 px), not by device. Portrait
tablets and phones get lists; landscape tablets and desktops keep tables.

1. **Phone navigation:** a bottom tab bar with Fleet, Alerts, Infrastructure, Keys and
   **More**, which respects the safe area. More opens a sheet with every page in its group,
   plus the account and sign-out. The top block is removed, so the page title is the
   first thing on screen. Viewers get the first four pages available to them.
2. **Tablet navigation:** an 84 px rail with icons and short labels, grouped like the
   sidebar, scrolling when short. The full sidebar returns above 1100 px and scrolls
   instead of clipping (T4).
3. **One header on every size:** title and icon actions on one row, with the summary on
   one line beneath. The description is hidden on phones. Page actions sit in a row below
   on phones and never wrap on tablets (T2).
4. **List rows** replace tables in narrow containers. Each row has a bold title and a status
   or chip on the right, one or two muted fact lines, and actions at the end. Empty cells
   disappear, and each table marks what matters. Fleet rows show platform, name, status,
   client, location, address and usage in about 76 px. The Fleet checkbox column is sized
   for touch (T5).
5. **Filters collapse** on phones behind a Filters button that shows how many are active.
   Search stays full width.
6. **Tabs** are compact, scroll sideways with the active tab in view, and stay pinned at
   the top of the machine pane.
7. **Machine pane on phones:** a one-line summary (client · address · OS · uptime) with
   "Details" to expand the full identity. Resource links become compact chips. The pane
   is full-screen on portrait tablets (T6).
8. **Dialogs become bottom sheets** on phones, with a compact close button.
9. **Touch targets** are at least 44 px for row actions, chips that act and tab buttons.
   Buttons never wrap mid-word (T3).
10. **B1:** stale-view signals are never shown as errors.

## Implementation record

Pending.
