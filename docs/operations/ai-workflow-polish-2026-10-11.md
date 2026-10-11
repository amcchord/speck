# AI workflow polish — October 11, 2026

This follow-up reviews the operator assistant, reviewed remote-screen steps and
external REST/MCP agent access. Three agents work on separate backend, frontend
and external-agent contracts. The parent chat owns integration and deployment.
The previous [UI review](ui-ux-polish-2026-10-11.md) remains the baseline.
The [18-image synthetic gallery](../screenshots/ai-workflow-polish/README.md)
shows context, review, history and recoverable error states.

## Context and workflows

The assistant receives the selected endpoint's identity and authoritative
Windows/Linux platform. Health, an existing terminal draft and original job
script/output have visible consent controls. Snapshot timestamps, missing
observations, alert severity/category and resolution guidance help distinguish
reported evidence from current state. Malformed telemetry cannot erase the
workflow or imply healthy observations. Provider instructions treat machine
labels, scripts, logs and screenshots as evidence rather than authority.

Tasks and drafts survive provider/settings failures and failed terminal handoffs.
A handoff checks the intended endpoint and keeps its verification and caution
with the proposed script. A request produces a draft; the operator still reviews
and explicitly runs it in the terminal. Real-provider inspection exposed a malformed non-ASCII Linux option and
unbounded directory sizing. Guidance now favors exact standard commands and
cheap targeted checks; a narrow Linux draft gate rejects malformed unquoted
option names while preserving Unicode data. This is not a complete shell parser.
Generated scripts require review and can contain errors; no provider response
proves execution or repair.

The screen assistant retains the task and up to five applied navigation summaries
for the current remote client. Typed text is omitted from history; changing the
task clears it. Requests are serialized and can be stopped. Responses from
closed, disconnected or superseded sessions cannot offer actionable input.
The shared capture, dimensions, time and exact actions are visible before Apply.

The whole action batch is validated before any input is sent. A changed screen,
expired proposal or unsupported action requires a new request/manual control.
The actual Guacamole client can retain a connected state after its tunnel closes,
while silently discarding input. An isolated reproduction confirmed that case;
transport readiness and close/error propagation now gate screen proposals and
input. Apply is claimed once before sending input; an uncertain local send or activity
receipt cannot replay it. Server receipts bind operator, endpoint, ordered action
types and expiry. The screenshot-only provider continuation remains read-only;
refusals and incomplete responses cannot trigger continuation or remote input.

## External agents

Initialization and `whoami` describe the token's effective role, scopes and
capabilities. The guide, drop-in document and MCP context agree on endpoint IDs,
platform shells and job results. Fleet/provider IDs do not imply an enrolled
computer. Dedicated endpoint details, recent job receipts and directory listings
make missing context discoverable without inventing API routes.

Command execution remains 5–180 seconds. MCP waits at most 30 seconds, then
returns the existing job receipt and polling path. Terminal success is
`complete`; queued/running/unknown receipts cannot be treated as success or
permission to submit a duplicate. Missing, malformed or unsupported arguments
produce actionable errors before submission. Truncated text and structured
results agree, and binary transfers supply authenticated REST download metadata.

External tokens can use authorized command/file/provider APIs. Interactive
PTY/RDP/VNC and screen-assistant sessions require a signed-in operator; token
access does not expose those transports. Existing opt-in endpoint previews
remain available to authorized REST clients; MCP provides binary download
metadata rather than an image tool. MCP supplies tools and resources,
with no reusable prompt templates. Reference: the served
[agent guide](https://speckrmm.com/agents.md).

## Qualification boundaries

| Capability | Windows | Linux |
| --- | --- | --- |
| AI endpoint/context contract | Isolated Windows fixtures | Isolated Linux fixtures |
| Script language | Real-provider PowerShell draft, reviewed but not executed | Real-provider POSIX sh draft; syntax and execution passed in a disposable, read-only Linux container |
| Endpoint command/file transport | Existing agent APIs; no new binary | Existing agent APIs; no new binary |
| Reviewed computer input | Synthetic browser clients and actual Guacamole transport-disconnect regression; existing RDP transport | Synthetic input adapter; GUI transport unchanged; SSH/shell workspace has no screen assistant |
| New physical-machine execution in this review | None | None |

Screen actions are limited to five supported inputs. Drag, horizontal scrolling,
unsupported key sequences and sensitive interactions require manual control.
A model proposal is not proof that input reached the intended application;
operators inspect the resulting screen. This release does not requalify physical
Windows/Linux desktops, native clients, audio or recovery correctness.

Implementation follows OpenAI's [function/tool continuation guidance](https://developers.openai.com/api/docs/guides/function-calling)
and [computer-use protocol](https://developers.openai.com/api/docs/guides/tools-computer-use).
Requests keep `store:false`; deployment does not change credentials, models or
provider retention policy. Provider keys, production captures and local test
results containing context stay in ignored `output/`.


## Real-provider validation

An isolated local database supplied synthetic Windows/Linux disk alerts and
health snapshots to the existing project-scoped OpenAI provider with
`gpt-5.4-mini`. Both responses returned bounded read-only investigation scripts,
verification and caution, and recognized insufficient evidence for a repair.
The Linux draft passed `sh -n` and execution in a network-disabled, read-only
container. The Windows PowerShell draft was inspected; it was not executed on
a Windows endpoint.

A synthetic 1280 × 720 image requested one click at the green target. The real
computer tool returned one validated left-click inside that target. No proposed
input was applied, and the isolated test database contained no jobs. Initial
provider failures exposed the nullable-action and Linux-option defects described
above; the final fresh three-request probe passed after those fixes.

## Local and live acceptance

The final `./scripts/check-local.sh core` run on release source `50d8fef` passed
in 292 seconds: Ruff, 399 backend tests, Linux agent/Proxmox race and runtime
checks, Windows/Linux cross-builds, TypeScript/Vite, 60 web units and 499
Chromium/WebKit browser tests. One existing WebKit touch-drag test remains
skipped. The suite includes 58 new AI workflow browser cases and the actual
Guacamole closed-transport regression. The earlier core run was interrupted
after cross-file review found that transport defect; it is not counted as a
full passing run. Native/iOS code is unchanged and was not requalified.

The build also reported two Python dependency deprecations, its existing large
JavaScript chunk warning and an existing `source-map-js` 1.2.1 development
dependency audit advisory. Dependency manifests are unchanged by this release.

Authenticated live acceptance passed in Chromium at 1440 px and WebKit at
390 px. Tasks survive opening the review dialog; model configuration, the
updated OpenAPI context contract and public agent guide agree with the release.
Anonymous MCP access is rejected. A direct live-provider request supplied only
a synthetic task and returned a PowerShell draft, verification and caution;
no endpoint command or input was executed.

The final private live sweep covers all 21 pages at 1440/834/390/320 px: 84
captures, no page errors, horizontal overflow, loading/error states or unexpected
writes. Temporary browser sessions were logged out. The complete UI/AI review
retained 1,067 private screenshot files, including repeated iterations, and
55 curated public synthetic captures across the two galleries. Production
screenshots and provider output remain in ignored directories.

## Deployment

Published `50d8fefc192c5aad1bcfb9a3ce266e0d5bc493ed` as
`20261011T210342Z-ai-polish-50d8fef`. The parent chat was the sole deployment
owner. Before the production build and again before publication, origin/main
was fetched and verified as an ancestor. Main `db2f55b`, the newer UX/entity
work through `df79045` and both prior UI releases are preserved.

The full live baseline matched under the shared release lock. The initial
settings snapshot drifted only because `management_tick` and
`slide_restore_sync` are periodic worker checkpoints. Those two keys were
excluded from the saved-configuration gate, and the sensitive settings baseline
was reconciled without writing settings; the other 13 protected groups and
source/index/environment/dependencies still matched the original snapshot.
Fourteen configuration and identity groups are protected in the reconciled
baseline, including actual saved settings and stable API-token fields.

Preflight found no active endpoint jobs, recovery runs, pending provider
operations, connector requests or remote transport connections. Server, web,
downloads, configuration and a consistent database backup were taken before
the brief service restart. The live index was compared again immediately before
atomic publication. Rollback is available at
`/var/lib/speck-rollback/20261011T210342Z-ai-polish-50d8fef`.

All 27 public web files match the validated build. Index SHA-256:
`cc2d0ce2594b4ca640170e00764c4359fc976c2ded6b3cf808a61446a82b5cbe`.
The service is healthy and active with PID 398942, replacing PID 151449.
The deployed backend exactly matches the release manifest. Dependencies,
environment, all 14 protected groups and agent downloads still match the
reconciled baseline after live acceptance. Credentials and provider models were
not changed, and no endpoint binary was published.

Both hosted backend/unit checks for `50d8fef` passed. Its hosted browser run
subsequently failed one Home search/filter assertion after 498 browser passes
and one existing skip. The trace showed the dismissed drawer's queued Close
handler returning focus after search clearing began. The earlier AI source
`e7872e6` passed all hosted checks. Local checks were the release gate. No required branch
check was bypassed and no PR was merged. Source and records are pushed on
[PR #28](https://github.com/amcchord/speck/pull/28), stacked on PR #27 to preserve
deployed work that has not reached main.


## Web focus and keyboard acceptance follow-up

Published `9dd65720a064de8872bc837e04c3cb53dfe968f8` as `20261011T213141Z-drawer-focus-9dd6572`. A queued machine/resource Close handler could move focus away from a newly selected search field. Dismissal now returns focus during close and only recovers lost body focus after queued cleanup. Explicitly selected outside controls survive; nested modal dismissal still returns keyboard users to the correct opener.

The intermediate `2472781` candidate was not published: its full local browser run failed five Chromium machine-overview focus cases, exposing the nested-modal variant. Its separate hosted run failed two cases after 501 passes and one skip: machine focus at 760 px and the 320 px WebKit remote keyboard assertion. These are test failures, not successful runs or simulator startup failures.

Fresh TypeScript/Vite, all 60 web units and all 509 Chromium/WebKit browser checks passed on the final source in 3.9 minutes, with one existing WebKit touch-drag skip. Ten new browser cases cover queued close, newly selected search fields and nested-dialog focus. Backend/agent code is unchanged from the previously qualified AI release. The transitive development dependency `source-map-js` was patched from 1.2.1 to 1.2.2; the fresh install reports zero vulnerabilities.

The live before/after reproduction confirmed the original focus theft in Chromium 1440 px and WebKit 390 px. Both now retain `home-query` focus with no errors or unexpected writes. Live AI draft review passed again at both widths; a synthetic task-only provider request returned a draft with verification and caution, without executing it. The final live screenshot sweep covers all 21 pages at 1440/834/390/320 px: 84 new private captures, no page errors, horizontal overflow, loading/error states or unexpected writes. Temporary sessions were logged out.

Origin/main was fetched and verified as an ancestor before the build and again before publication. The newer deployed releases, exact live baseline and all 14 protected configuration/identity groups were preserved under the shared release lock. The live index was compared again immediately before atomic replacement. This publication changes only web assets: backend, server dependencies/environment, saved configuration, endpoint downloads and PID 398942 remain unchanged; no restart was needed. All 27 public files match the build. Index SHA-256: `233fbab20cca8f212a4a0682cbb0e5889b4d45ecfb6b50736e20d87a3314b2b4`. Web rollback: `/var/lib/speck-rollback/20261011T213141Z-drawer-focus-9dd6572/web`. The prior AI release retains the full server/configuration/database rollback.

All hosted backend, unit and browser checks pass for `9dd6572` (browser run `38176452826`). Local validation remains the release gate; no required branch check was bypassed and no PR was merged.


## Stable remote controls and deterministic browser fixtures

Published `6ccb2adc19048ea8c91216ab1a740dfec44f333e` as
`20261011T214601Z-remote-header-6ccb2ad`. Remote connection status could wrap behind
phone controls and move the toolbar during disconnect/error transitions, changing the
target under a pending click. The phone title/status now has a full-width row with two
reserved status lines. Larger displays keep their existing flex flow and normal header
height; the compact status is ellipsized and the full error remains readable in the
screen overlay.

Trace review of the earlier hosted keyboard failure also found an unreliable fixture:
WebSocket interception was registered after the document loaded, followed by hash-only
navigation, and its URL pattern did not explicitly match Guacamole's empty query string.
The fixture now installs before loading the document, matches `/ws?` and verifies that
the actual socket was intercepted before controls are clicked. It sends synthetic
Guacamole drawing/error frames and mocked audio counters; it does not open a real
endpoint transport.

Twenty focused checks passed in Chromium/WebKit at 1440/834/760/390/320 px. Geometry
stays stable through waiting, connected, Audio idle, audio-byte statistics, a long
protocol error and disconnected states. The transient error is measured before
Guacamole's synchronous disconnect callback; the full overlay message remains readable,
and the Keyboard click opens the intended dialog. Twelve focus regressions and
TypeScript also passed. The initial fixture run was interrupted after readiness
assertions failed; an intermediate geometry run found four tablet failures before the
status constraint was added. These historical failures are preserved privately and are
not counted as passes.

The fresh final production web build, 60 web units and all 519 Chromium/WebKit browser
checks pass, with one existing WebKit touch-drag skip. Backend and agent code remain
exactly the previously qualified `50d8fef` release, whose local core passed 399 backend
tests plus Linux runtime/race and Windows/Linux platform builds. All hosted checks for
the intervening `9dd6572` source pass. All hosted backend, unit and browser checks pass for deployed source `6ccb2ad`
(browser run `38177379280`: 519 passes and one existing skip).

The public AI gallery now contains 20 synthetic captures, including two full 320 px
remote-workspace states, for 57 public screenshots across both galleries. Hashes and
byte counts were verified. A new live sweep covers all 21 pages at four widths: 84
private screenshots with no page errors, overflow, loading/error states or unexpected
writes. Read-only live focus and AI review checks pass again on desktop/phone; no
additional provider request, endpoint command or physical remote input was needed.
Existing real-provider qualification remains unchanged. Temporary browser sessions were
logged out and isolated preview servers were stopped.

Origin/main and the previous deployed AI/focus releases were verified as ancestors
before the build and publication. The shared deployment lock, exact live baseline and
immediately preceding index protected publication. All 27 public web files match the
validated build. Index SHA-256:
`d2c3444a0b383af64b01b792ed6a14c3cfed7247e6265688cc568d5acd8cb7eb`. Web rollback:
`/var/lib/speck-rollback/20261011T214601Z-remote-header-6ccb2ad/web`. Backend,
dependencies/environment, all 14 protected configuration/identity groups, endpoint
downloads and healthy PID 398942 are preserved without a restart. No required branch
check was bypassed and no PR was merged.


## Main merge and production reconciliation

Merged [PR #26](https://github.com/amcchord/speck/pull/26), [PR
#27](https://github.com/amcchord/speck/pull/27) and [PR
#28](https://github.com/amcchord/speck/pull/28) into `main` in dependency order with
ordinary merge commits. PR #27 was marked ready and #27/#28 retargeted to main after
their dependencies merged. All three original PR heads had passing backend/unit and
browser checks; merge operations were pinned to their inspected head SHAs. No required
branch check was bypassed. Final application merge:
`8587ff67514de23092fd29c54fb27b5c1dda322c`. Its complete source tree is identical to
reviewed PR head `75b7864`; the earlier deployed backend, web and agent work remain
ancestors.

Before the fresh production build, origin/main was fetched and verified as an ancestor.
`./scripts/check-local.sh core` passed on merged `8587ff6` in 343 seconds: Ruff, 399
backend tests, Linux agent/Proxmox runtime and race tests, Windows/Linux platform
builds, TypeScript/Vite, 60 web units and 519 Chromium/WebKit browser checks, with one
existing WebKit touch-drag skip. The fresh install reports zero vulnerabilities.
Existing Python deprecations and Vite chunk warnings remain. Native/iOS and physical
desktop qualification are unchanged.

Production already contains every runtime change in merged main. The fresh main web
build matches all 27 public files byte for byte; backend source and server requirements
match too. A freshly initialized isolated database was compared with production through
read-only schema queries: all 58 tables, 396 columns and nine explicit indexes are
present and match, with no missing schema migration. Database integrity is `ok`; the
isolated database was deleted. No production data transformation, runtime replacement or
restart was needed.

Authenticated live AI review, API-guide/context and search-focus acceptance passed in
Chromium at 1440 px and WebKit at 390 px. A new 21-page sweep at 1440/834/390/320 px
produced 84 private captures with no page errors, horizontal overflow, loading/error
states or unexpected writes. No provider request, endpoint command, remote input,
recovery or equipment action was performed; temporary sessions were logged out.

The sole deployment owner held the shared release lock, matched the entire live baseline
and compared the index again immediately before recording the main equivalence
confirmation. Confirmation `20261011T221349Z-main-verified-8587ff6` is stored privately
at `/opt/speck/releases/20261011T221349Z-main-verified-8587ff6/release.json`. Web index
SHA-256: `d2c3444a0b383af64b01b792ed6a14c3cfed7247e6265688cc568d5acd8cb7eb`. Existing
web/backend rollback and consistent database backups remain available. All 14 protected
configuration/identity groups, credentials, server environment/dependencies, endpoint
downloads and healthy PID 398942 are unchanged.

All hosted backend/unit and browser checks pass for merged application `8587ff6`
(backend run `38179131677`, browser run `38179131673`: 519 passes and one existing
skip). All pre-merge checks passed. Local validation is the
primary release gate. The merged source is on GitHub main; operational records are the
only additional source edits. Private manifests, schema comparison, confirmation and
acceptance evidence remain in ignored `output/pr28-main-production/`.
