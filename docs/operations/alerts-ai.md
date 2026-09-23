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

Implemented in `worktrees/alerts-ai`, branch `codex/alerts-ai`. This branch includes
the deployed Fleet toolbar release `1158014` and its record `6faaf5c`.
No production deployment, provider AI request or endpoint repair was performed by
this task. Synthetic model responses validate the API and review flow; diagnosis
quality on a real alert remains unverified.

The backend and web bundle must be released together. No schema migration or agent
upgrade is required. Before a future authorized release, follow `AGENTS.md`: fetch
main, preserve all newer live changes, coordinate the deployment owner, inspect the
live index, and back up matching backend/web/database/configuration state. Keep the
current web/backend pair for rollback and verify alert list/detail and AI setup
without automatically queuing endpoint commands.

See the [synthetic screenshots](../screenshots/alerts-ai/README.md) and
`server/tests/test_alert_context.py`, `web/test/ui/alerts.spec.mjs` for the specific
security, lifecycle, evidence, role, responsive and review-before-execution checks.
