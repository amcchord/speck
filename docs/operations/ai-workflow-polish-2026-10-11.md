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
