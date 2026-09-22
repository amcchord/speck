# Speck

Read WORKBOOK.md before changing deployed systems. Speck is a separate open source
RMM project. Keep provider keys, credentials, customer configuration and private
remote-session data out of source control. Use AustinLand for scoped credentials.
Windows and Linux are first-class supported targets. Report each platform's
verified capabilities honestly. Keep recovery tests isolated and preserve source
machines; restored endpoints must not impersonate or overwrite their originals.
Do not alter unrelated AustinLand workloads. Record deployments and validation.

Before every production build, fetch origin/main and confirm it is an ancestor of
the release commit. Also preserve any newer deployed work that has not yet reached
main. Coordinate a single deployment owner across active tasks. Immediately before
publishing, compare the live index with the inspected baseline; if it changed,
reconcile the new release before publishing rather than overwriting it.

Prefer local validation for release decisions: `./scripts/check-local.sh core`
runs backend, Linux agent, platform builds, web unit and browser checks;
`./scripts/check-local.sh ios` runs iPhone units and iPad layout on this Mac.
Choose the checks relevant to the change. GitHub CI remains a secondary check.
If hosted CI fails before executing a test (such as simulator launch timeout),
record that failure and the corresponding local result separately; do not call
the hosted run successful or bypass a required GitHub branch check.
