# Alerts and AI assistance

The Alerts page uses compact rows, aligned machine/status columns and small
fleet-wide counts. Select an alert title to expand its evidence and review actions.
At 1440 pixels wide, rows are 76–78 pixels tall; controls wrap on phones.

Job alerts use operation names when a batch name is available, otherwise a
readable job kind. Existing alerts receive the improved copy without a migration:

- **Completion unconfirmed**: the agent did not report a final result. Changes
  may have happened; inspect the effects before retrying.
- **Did not start in time**: a queued job expired before the agent picked it up.
- **Failed**: the agent reported failure. Output can show which step failed.

Expanded job evidence includes the original command, returned output, exit code,
requesting operator and times. Scripts/output are bounded excerpts. Connection
credentials and non-command payloads are excluded. Viewer accounts retain alert
summaries but cannot retrieve job evidence or request AI help.

**Acknowledge** records that someone has seen the alert. **Mark reviewed** closes
a job alert without retrying, undoing or fixing anything. Health alerts continue
to clear only after a fresh healthy observation. Filtering does not change the
fleet-wide counts; filtered empty results do not claim the entire fleet is healthy.

## Diagnose or fix

Operators can select **AI diagnose** or **AI fix** for a manageable machine.
The dialog starts with the selected alert and a suggested editable request:

1. Review the context. Current OS, CPU, memory, disks, services and collection
   timestamps are selected by default. Original script and job output are
   separately opt-in because they can contain sensitive data.
2. Select **Diagnose this alert** or **Propose a fix** to send the request to the
   configured OpenAI provider. Alert and safe job metadata are fetched by the
   server and bound to the target machine. API keys remain server-side.
3. Review the explanation, proposed script, cautions and verification. Diagnosis
   instructions require read-only checks. Repair instructions require evidence,
   bounded changes and rollback; insufficient evidence should yield checks first.
4. **Review in terminal** transfers the script to that machine's existing command
   editor, preserving the alert title, cautions and verification. Edit as needed
   and explicitly select **Run command** to queue an audited command.
5. Inspect the reported result and perform the proposed verification. A successful
   command is not automatically proof of recovery, and does not close the alert.

AI has no execution tool. Model scripts are proposals and require operator review;
read-only behavior is an instruction to the model, not a script sandbox. Unknown
jobs must not be blindly replayed. Offline machines can receive analysis of
recorded evidence; reconnect them before executing a draft. Already-resolved
alerts cannot generate a new repair request. Retired/unapproved machines and
viewer accounts cannot use the workflow.

## Validation and release status

Deployed September 23, 2026 from `65f668d` on `codex/alerts-ai`, preserving
Fleet toolbar runtime `1158014` and release record `6faaf5c`. Local Ruff,
TypeScript/Vite, 166 backend and 28 web unit tests passed. Browser validation
finished with 159 passing scenarios across the full run and focused reruns, and
one existing WebKit touch/CDP skip.

Preflight verified all 29 previous backend files, all 26 current web build files,
the dependency manifest, SQLite integrity, no active jobs/recoveries and no gateway
connections. The live index was checked again under the release lock immediately
before publishing. Backend/web/configuration and stopped-service data were backed
up, including an integrity-checked SQLite snapshot. No schema migration, dependency
change or agent upgrade was required. Service health and protected identity,
account, settings, preferences, integration and recovery fingerprints matched.

Live Chromium desktop and WebKit phone checks passed: all five alert outcomes,
expanded job evidence, diagnosis/repair dialogs, responsive layout and preserved
Fleet toolbar. One real diagnosis used alert metadata with health and original
script/output sharing disabled; its response and correct-machine terminal handoff
passed. No endpoint job was queued, and no alert was acknowledged or closed.
This verifies the provider connection/review workflow, not actual repair success.

Exact release: `20260923T135104Z-alerts-ai-65f668d`. Current index SHA-256:
`4cf1d5c3ad2126b7aaa5a0d9e95fa531c18152fea03b48109ae58fcd7e5121c3`.
Rollback: `/var/lib/speck-rollback/20260923T135104Z-alerts-ai-65f668d`.

Before rollback, inspect current jobs/sessions and back up present state. Restore
the matching previous `server/` and `web/`, restart Speck, then verify health,
login and source hashes. This release made no schema/configuration changes; retain
the latest database rather than discarding subsequent user activity. The matching
data/configuration snapshot remains available for an explicitly reviewed recovery.
Private scripts, source audits and live evidence are in ignored `output/alerts-ai/`.

See the [synthetic screenshots](../screenshots/alerts-ai/README.md) and
`server/tests/test_alert_context.py`, `web/test/ui/alerts.spec.mjs` for the specific
security, lifecycle, evidence, role, responsive and review-before-execution checks.
