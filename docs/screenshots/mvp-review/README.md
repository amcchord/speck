# Management review screenshots

Captured September 22, 2026 from the actual implementation in an isolated local
Speck server. Machines, telemetry and accounts are synthetic. These are UI evidence,
not proof of successful remote operations on real endpoints. Original PNG bytes are
retained; SHA-256 digests and sizes are in [manifest.json](manifest.json).

Desktop review used 1280×720; mobile review used 390×844. Full-page captures include
scrollable content beyond those viewport heights. No images were retouched.

| Alerts | Schedules |
| --- | --- |
| [![Desktop alert inbox](alerts-desktop.png)](alerts-desktop.png) | [![Desktop schedules](schedules-desktop.png)](schedules-desktop.png) |
| [![Mobile alert inbox](alerts-mobile.png)](alerts-mobile.png) | [![Mobile schedules](schedules-mobile.png)](schedules-mobile.png) |

[![Accounts and roles](accounts-desktop.png)](accounts-desktop.png)

[![Per-machine service and health policy](monitoring-policy.png)](monitoring-policy.png)

Tested interactions: acknowledge an alert, create/review/pause a Linux health-check
schedule, filter audit history, open device policies and account controls, and sign
in as a viewer to verify management actions are absent. Two-factor cryptography,
code replay/recovery, permissions and revocation were tested through the backend
test suite; no real authenticator, operator credential or endpoint was changed.

## Safari select verification

[![Native Safari fleet filters](safari-fleet.png)](safari-fleet.png)

Native Safari, September 22: branded closed controls, native option menus, mouse
selection and keyboard selection verified against the local synthetic fleet. The
live Windows remote toolbar was also visually checked after deployment; its select
height, colors and arrow now match the adjacent buttons. Native menu inspection
confirmed the repaired Ctrl + Alt + Del option. Remote screenshots remain private.
