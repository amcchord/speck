# iOS qualification

Candidate: **Speck 0.1.0 (1)**, universal iPhone/iPad, iOS 18 minimum.
App Store Connect: **Speck RMM**, Apple ID `6814871051`, bundle `com.speckrmm.ios`.
The internal **Speck testing** group contains the account holder; automatic
build distribution is disabled. TestFlight upload is pending final qualification.

## UI review and corrections

The initial screenshots exposed inconsistent button padding and alignment. Screen,
PowerShell, sign-in and reviewed operations now share a centered action style with
at least 48-point height. The main connection buttons have equal widths and aligned
centers. Accessibility text sizes stack those actions and summary cards vertically;
restored-machine status and utilization use separate lines to avoid broken words.

On iPad, a fleet column remains visible beside machine details. Phone navigation
uses native push views. Search is always discoverable. The script editor disables
smart punctuation/autocorrection, preserves literal quotes and dashes, offers a
keyboard-dismiss control, and pins Review & run above the bottom safe area.

Remote sessions open as a full-screen workspace with native Done and Controls.
The desktop occupies the remaining area; duplicate web headings and desktop-launch
controls are hidden. Optional controls scroll horizontally and clipboard controls
align in a compact grid. The shared remote Keyboard panel supports ordinary text,
new lines/Return, Tab, Escape and Backspace. Text is sent only after the operator
chooses Type text. This is separate from the native reviewed PowerShell/shell editor.

The [28-image gallery](screenshots/ios/README.md) contains real, unretouched
synthetic captures. Both phone and tablet were inspected in portrait/landscape,
light/dark appearance and accessibility text size. XCTest screenshots use the full
screen for rotated views; app-bounds captures during rotation were discarded.

## Verification

| Area | Result |
| --- | --- |
| Models and session safeguards | 11 unit tests pass: HTTPS origins, ports, JSON, telemetry, job states, retired/revoked devices, distinct restore identity and rejected demo writes |
| Native UI | Seven UI scenarios pass on both simulators: navigation/action geometry, literal script input, search, destinations, sign-in, large text and landscape/dark captures |
| Real authentication | Signed simulator logs in through the real API and persists its session in Keychain |
| Windows and Linux commands | Harmless platform/marker commands complete through the native session code |
| Windows and Linux file transfer | 256 KiB binary upload, download, SHA-256/byte comparison and exact test-file cleanup pass on each platform |
| Live inventory | Fleet, alerts, jobs, update reports, templates, schedules, recovery plans/runs and account access endpoints pass |
| Windows remote | Actual desktop displayed in WKWebView; controls toggle, password dialog, dismissal and return to native network detail pass |
| Linux remote | SSH rendered; text typed through the mobile Keyboard panel executed a harmless printf command and displayed its expected marker |
| Web regressions | 21 tests plus TypeScript/Vite build pass, including Unicode/newline mapping and existing startup/microphone behavior |
| Signing | Release archive and App Store distribution export pass with automatic signing |

Private evidence lives under ignored `output/ios/`: `.xcresult` bundles, live test
source, original operational screenshots and scoped release tooling. Public UI tests
use `--demo`; release builds cannot activate it. Unsigned simulators cannot validate
Keychain storage, so authenticated tests use normal simulator code signing.

## Limits

This is an internal beta, not a claim of completed production qualification.
Physical iPhone/iPad touch, audio output, microphone and hardware-keyboard quality,
older supported iOS versions, Linux graphical desktops, VNC, interrupted large file
transfers and long-duration mobile/background behavior still need device acceptance.
No new Slide recovery, OS update installation or software deployment was triggered
by this iOS qualification. Existing recovery evidence was read; originals, clones,
backups and bindings were preserved. There are no push notifications or offline
management. Use the web console for enrollment/account administration, editing
plans/templates/schedules and recovery clone approval/resource shutdown.
