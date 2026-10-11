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
