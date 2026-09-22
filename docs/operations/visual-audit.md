# Shared UI rollout — September 22, 2026

Production frontend source: `2c2231181e1656359a68504c2f95def5c771683d`.
[PR #8](https://github.com/amcchord/speck/pull/8) includes the compact Fleet and
row/pane changes from #6 and #7. UI details and qualification limits are in the
[audit](../ui-review.md#shared-ui-and-native-audit--september-22-2026) and
[gallery](../screenshots/visual-audit/README.md).

## Web and desktop

The static release is live at https://speckrmm.com. Assets were uploaded before
an atomic index replacement, retaining old hashed assets for existing clients.
The served index, scripts and CSS match local SHA-256 hashes. `/health` passed;
the service PID/start timestamp and all 18 device IDs were unchanged.

- JavaScript: `index-C--fVFkl.js`
- Stylesheet: `index-ccyIhl3W.css`
- Index SHA-256: `269b61740906dfb631c54976775c2e1270c54c713f235d7232739e6ddd39570f`
- Rollback: `/var/lib/speck-rollback/20260922T202255Z-visual-audit-2c22311/web`

Restore that backup's index atomically to `/opt/speck/web/index.html` to roll back;
its referenced assets remain available. The backup also contains the complete
previous web tree. No server restart is needed.

The installed Apple silicon Speck Desktop 0.2.2 was relaunched with retained
sign-in and visually checked against the live Fleet and Settings pages. Open
clients pick up the new console when reloaded/reopened. Existing Mac, Windows and
Linux wrappers use this hosted frontend; no new wrapper package is required.
Windows/Linux runtime acceptance was not repeated for this shared-style release.

## Native iPhone/iPad

Universal **0.1.2 (5)** is VALID and IN_BETA_TESTING in the existing **Speck testing**
internal group. App Store Connect build ID: `c6cddb25-ee70-4b93-ace4-5fafc8c69d77`.
The archive was signed/exported/uploaded with the existing app identity and
associated-domain entitlement. The production Swift source matches `9170747`;
subsequent changes only integrated web work and documentation.

What-to-test notes describe the full-width masthead, compact controls, dark
appearance and secondary-page checks. Group membership was read back after
assignment. Signing keys were read from AustinLand into restricted temporary files
and removed after archive/export/upload. Previous internal builds remain available.

Private logs, XCResult bundles, processing/group evidence and deployment checks are
under ignored `output/visual-audit/` in the audit worktree. This visual rollout did
not update backend code, agents, endpoint credentials, Slide configuration or
recovery resources, and did not issue endpoint commands.
