# Monitoring, access and scheduled operations

Speck manages one organization. Admins and operators can act on its entire fleet;
these roles do not provide tenant or per-site isolation. Sites and tags organize
machines and are searchable in Fleet.

## Alerts

The server evaluates health every 15 seconds. Default policy: offline after 180
seconds; CPU/memory at 95%, disk at 90%, sustained for 120 seconds. Resource
alerts clear five percentage points below their trigger. Configure defaults from
Alerts, or an individual machine's **Watch services & health** control. Service
names must match the agent's service inventory (for example `Spooler` on Windows
or `asterisk.service` on Linux).

Only approved, active devices are monitored. Stale or malformed telemetry is
unknown, not healthy. Missing disks do not clear a prior disk alert. Acknowledging
an alert records an operator and time; health alerts resolve when fresh data shows
recovery. Failed, expired and unknown jobs create separate alerts, which an
operator can resolve after reviewing their output. Jobs older than 24 hours are
not backfilled as new alerts. Existing alerts remain in history.

Maintenance suppresses new alerts and resets pending threshold timers without
hiding existing conditions. It lasts until the selected time, at most 31 days.
Disabling a policy or archiving a machine resolves its active alerts as a policy
change. Alerts are retained in SQLite and survive restart. The inbox has status
and machine filters and an older-history cursor; navigation shows unacknowledged
conditions. The monitoring status distinguishes an active worker from a delayed
one. Notifications currently stay in the console; email/webhook escalation and
volume exclusions are not implemented.

## Scheduled work

Schedules support native Windows/Linux patch **scans** and reviewed script or
software templates. Select machines, parameter values, the first run in your
local time, and a one-time or recurring interval. Review the exact scripts before
saving. Targets are a fixed snapshot; later site/tag changes never silently expand
them. A schedule pins the template revision. Editing that template pauses future
runs until a new schedule is reviewed.

Creation is idempotent for the request ID. Each occurrence is claimed in the same
SQLite write transaction that enqueues its batch, including when two workers tick
concurrently. An offline, retired, outdated or busy target skips the entire
occurrence. A run more than five minutes late is recorded as missed; recurring
schedules advance to the next future occurrence without a catch-up storm. Pausing
stops future occurrences; already queued/running jobs remain visible in the batch
and can be cancelled where they have not started. An account disabled or changed
to viewer loses future scheduling authorization.

This guarantees one enqueue per claimed occurrence, not successful execution or
exactly-once external side effects. Agents retain their existing execution journal;
interrupted commands become **unknown** and are never automatically replayed.
The periodic worker now expires every overdue job even if its endpoint never
reconnects. Reboots, unattended patch installation and automatic Slide recovery
creation are intentionally separate future work.

## Accounts and two-factor sign-in

Settings → Manage access exposes personal password/session controls. Admins also
create, disable and change accounts:

| Role | Access |
| --- | --- |
| Administrator | All operations, provider credentials and accounts |
| Operator | Fleet operations, enrollment, remote access, files, scripts, recovery, schedules and alert acknowledgement |
| Viewer | Inventory, alerts and audit reads; personal password, session and two-factor settings |

Authorization is enforced by HTTP/WebSocket endpoints. Viewers cannot obtain
remote screen content, file transfers, scripts, command output or recovery plans.
A role change, disable or admin password reset revokes every session for that
account and closes its remote sessions. Personal password changes preserve the
current browser session and revoke the others. The last enabled administrator
cannot be disabled or demoted.

Authenticator setup requires the current password and a valid six-digit code.
The temporary setup expires after 10 minutes. The secret is encrypted with the
server's existing encryption key. Accepted time steps cannot replay; ten recovery
codes are hashed, shown once, and consumed atomically. Disabling two-factor or
changing a password requires the current password and, when enabled, a fresh
code. Enabling two-factor invalidates other sessions. Two-factor is opt-in and
is not silently enabled for existing users. See the [PyOTP security guidance](https://pyauth.github.io/pyotp/)
for the underlying protocol constraints.

Keep recovery codes and an independently secured administrator account available.
This release does not include SSO, WebAuthn, mandatory organization-wide MFA,
email password resets or a web bypass for lost authenticators. A server operator
with access to the deployment keys/database must handle an account recovery when
all authenticators and recovery codes are lost. No setup keys or recovery codes
are written to audit events.

## Device retirement

**Archive machine** is reversible. It removes a machine from the default fleet,
cancels queued jobs, marks already leased work unknown, disables previews and
closes remote sessions. Running endpoint processes may still complete. Inventory,
audit, Slide linkage and hardware identities are retained. Settings → View archive
can restore an unrevoked machine to the fleet. Removing approval also stops
management and closes remote sessions.

**Revoke installation credential** is admin-only and permanent. Original machines
and restored copies can share that credential; Speck lists every affected instance
and requires that exact set to be confirmed. A newly discovered clone invalidates
an earlier confirmation. All listed instances are archived and their credential
is rejected. Fresh enrollment is required to manage them again. This never
uninstalls software, deletes a backup or removes a Slide recovery resource.

## Audit and retention

Activity filters events by actor, action substring, machine and local date range.
Pagination uses stable event IDs. Export downloads only the loaded, filtered
records as JSON and records that scope inside the file. Job history remains
available separately. New audit records include identities and actions, not
passwords, authenticator secrets, recovery codes or scheduled script parameters.

Alerts, schedules, job results and audit events are retained without automatic
purging in this version. Monitor the SQLite/data volume. File transfer retention
and a supported cleanup workflow are still release follow-ups.

## Deployment and rollback

Deployed September 22, 2026 from `92831ae`, after the Desktop 0.2.1 release.
Live acceptance covered scheduled Windows/Linux update scans, role boundaries,
TOTP/recovery codes, synthetic service alert recovery, retirement and audit.
See the [deployment record](operations/management-rollout.md).

1. Use one Uvicorn worker: the command/alert scheduler uses durable SQL claims,
   but existing remote sessions and preview frames are process-local. Multiple
   web workers are not a supported deployment topology.
2. Before startup, preserve a consistent SQLite backup (`sqlite3.Connection.backup`
   or the SQLite backup command), the data/transfer directory, and the existing
   encryption key through the deployment's private backup procedure. Keep keys
   out of reports and source control. Record the current server/web artifact IDs.
3. Install the updated pinned `deploy/requirements.txt` (PyOTP is now a runtime
   dependency), deploy matching server and web artifacts, then restart once.
   Startup adds columns/tables/indexes without replacing identities or sessions.
4. Validate login, roles, `/api/monitoring`, a synthetic alert, a one-time scan
   on an approved disposable machine, results, audit, pause and restart behavior.
   Compare original installation/device IDs and Slide links with the preflight.
5. For rollback, stop the new service and restore the matching pre-change
   database, server and web artifacts together. Do not run the old bootstrap
   code against the expanded schema or replay jobs created after the backup.
   Old authentication code does not enforce the new operator/viewer roles; code-only
   rollback could silently give those accounts administrator privileges.
   Inventory outstanding commands and provider operations before rollback; their
   external effects cannot be undone by restoring SQLite.
