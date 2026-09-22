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
