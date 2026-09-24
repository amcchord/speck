# UI/UX audit — September 23, 2026

Every page, tab, machine pane and primary dialog was captured at **1920 × 1080** in
Chromium against production (speckrmm.com, release `5f9cfd2`) with real inventory:
243 machines, 283 infrastructure resources, 286 domains, 683 LAN clients and 43 vault
entries. Captures (with customer names) stay in ignored `output/ui-audit/before/`.
No page overflowed horizontally and no page raised a script error.

Goal: **powerful, simple, clean**. Show what matters first, remove repetition,
keep every capability one click away, and make every page follow the same rules.

## What works

- The visual language (forest sidebar, paper surface, one accent, Inter) is calm and
  consistent. Status badges, chips and tables read well at 1920 px.
- Fleet is the strongest page: compact rows, sortable/draggable headers, saved views.
- Destructive actions are reviewed and typed-confirmed; secrets are masked by default.
- Machine panes keep context (non-modal, row stays highlighted).

## Cross-cutting findings

| # | Finding | Impact | Fix |
| --- | --- | --- | --- |
| G1 | Sidebar lists 15 destinations with no grouping; Downloads competes with daily tools. | Slow scanning, feels heavy. | Group into **Operate**, **Infrastructure**, **Admin**; move Downloads to the account footer. |
| G2 | Every page has a labelled **Refresh**, including static pages (AI assistant, Downloads, Settings, Account); Patches, Software and Recovery add a second section Refresh. | Noise; unclear which one to press. | One icon-only refresh in the header, only on pages that load live data. |
| G3 | Summary numbers are 80 px cards on Network, Keys and Patches, but inline text beside the title on Fleet. | Inconsistent; pushes content below the fold. | Use Fleet's inline summary in the header everywhere. |
| G4 | Primary actions sit in the header on Fleet, in an intro row on Schedules/Infrastructure/Software, inside a card on Recovery, and in toolbars on Keys/API. | Users hunt for the main action. | Primary page actions live in the header, right-aligned. |
| G5 | Fixed-height inner scrollers on Patches, Jobs and Activity clip rows (Patches overlaps its footnote; Activity shows 9 of 100 loaded events). | Content looks missing; double scrollbars. | Let tables flow with the page; paginate long lists instead. |
| G6 | Empty values ("—", "Unassigned", "No Speck agent", "never") use full-strength text. | Real data is hard to spot among placeholders. | Render placeholders muted. |
| G7 | Very long pages: Infrastructure 22,300 px, LAN clients 20,900 px, Domains 17,600 px, Jobs 10,100 px. | Slow, hard to scan. | Denser single-line rows and incremental "Show more" paging. |
| G8 | Raw machine codes shown to people: audit events (`api_token.revoked`), provider receipts as JSON, device IDs (`f81bba0e25`). | Hard to read. | Human labels with the code available on hover/expand. |

## Page findings

**Fleet** — RAM can read above 100% (provider ballooning). Placeholder cells dominate
provider-only rows (G6). *Fix:* clamp display to 100% with the raw value on hover; muted placeholders.

**Machine pane (endpoint)** — ~480 px of identity metadata before the tabs; the new
reach strip repeats the IP shown directly below it and labels a malformed IPv6
(`::2ca6:…`) as public. *Fix:* only global-unicast IPv6 counts as public; hide the strip
when it adds nothing beyond the reported IP; tighten header spacing.

**Machine pane (Proxmox)** — status shown twice; VMs without a display get a 280 px black
box plus the same message repeated below. *Fix:* compact notice instead of an empty
preview frame when no display exists.

**Alerts** — solid. The expand chevron floats mid-row; AI buttons repeat on every row at
full weight. *Fix:* align chevron with the title; quieter AI buttons.

**Schedules** — missing space in "11:17:49 AMView operation results". *Fix:* spacing; header action.

**Patches** — inventory trapped in an inner scroller that clips the last rows and
overlaps its footnote; duplicate Refresh. *Fix:* G5, G2, G3.

**Software & scripts** — "1 inputs"; duplicate Refresh. *Fix:* pluralization, G2, G4.

**AI assistant** — Refresh does nothing; footnote uses body-large type. *Fix:* G2, smaller note.

**Recovery lab** — clear; duplicate Refresh and primary action inside a banner card. *Fix:* G2, G4.

**Slide** — each protected system is an 84 px card containing only a name and "agent".
*Fix:* compact table (name, kind) with the cleanup policy as a slim panel.

**Infrastructure** — 73 px two-line rows; "Provider only / No matched Speck endpoint
agent" repeated on ~280 rows; one filter stranded on its own row; a **DNS & network** tab
that now only links elsewhere; Activity shows raw JSON receipts. *Fix:* single-line rows
with a management chip, one filter row, remove the tab (bridge tools stay under
Connections → Manage), summarize receipts with raw JSON behind a disclosure.

**Network & DNS** — two-line domain rows repeat "cached 55 min ago"; every row shows
the same three protection chips; 286 rows and 683 clients render at once. *Fix:* single-line
rows, only show protection exceptions (manual renew, unlocked, no privacy), page 100 at a time.

**Keys** — a full table header repeats for each of 14 project groups; "Imported from
AustinLand" repeats on 43 rows. *Fix:* one table with group rows; origin shown in the pane.

**API & agents** — revoked tokens have the same weight as active ones. *Fix:* show active
tokens; inactive behind "Show N inactive".

**Activity** — only 9 of 100 loaded events visible (inner scroller); raw event codes.
*Fix:* G5, human event names with the code on hover.

**Job history** — repeats the Activity audit trail; jobs table clipped; raw device IDs.
*Fix:* jobs only, full height, device labels.

**Settings** — two narrow columns leave a third of the screen empty; "Revoke" wraps to
"Revok / e"; remote-access copy appears in two cards. *Fix:* responsive three-column
grid, non-wrapping buttons, single remote-access card.

**Account & access** — passkeys card switches to larger type; disabled QA accounts
clutter the operator list. *Fix:* consistent type; hide disabled accounts behind a toggle.

**Downloads / Sign-in** — clean. Downloads leaves the primary navigation (G1).

## Implementation record

The changes above were implemented in `claude/ui-audit`; see the journal entry for the
release, the validation that ran and before/after captures.
