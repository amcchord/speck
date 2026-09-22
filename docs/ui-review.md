# Speck UI review — September 22, 2026

The brand and interface were reviewed in the browser, adjusted, and captured
again. The [gallery](screenshots/README.md) uses the production frontend with safe
synthetic fixtures; the installer/agent verification used the real lab machines.

## Findings and changes

| Finding | Change |
| --- | --- |
| Unicode logos and navigation symbols vary by platform | One outlined wordmark, SVG mark and consistently drawn SVG icons |
| Typeface depended on fonts installed on the viewing machine | Inter 4.1 self-hosted with its OFL license; logo is font-independent |
| Small, pale labels and faint focus treatment | Larger working text, darker supporting text, stronger field boundaries and focus rings |
| Mobile navigation hid sign-out and refresh | Both remain reachable; navigation retains text labels |
| Narrow cards repeated hostnames and squeezed useful content | Remove repeated hostname, scroll cards horizontally, hide the redundant app line on narrow cards |
| Large fleets were difficult to scan | Search and status filters, a bounded device list, explicit no-results feedback |
| Small-screen network test form was cramped | Dedicated two-column arrangement; horizontal table/tab scrolling stays within its region |
| Activity exposed abbreviated internal IDs instead of names | Resolve the readable device label and tighten row spacing |
| Healthy Slide resources looked like warnings | Shared semantic status colors; always accompanied by words |
| Small transfers rounded to 0.0 MB | Show bytes/KB before MB/GB |
| Remote sessions were unnecessarily scaled down on laptop screens | Use the available height down to the supported 480px minimum |
| Clipboard button said Paste but only copied text | Label it Copy to remote and explain that pasting occurs in the remote application |
| Some fields and progress indicators lacked accessible names | Explicit labels, named dialogs, selected-state attributes, skip link and live notifications |
| Installers and Windows files looked generic | Shared terminal naming/steps, service metadata, embedded icon and file details |

The sign-in screen keeps the wordmark, the single requested tagline and the form.
No marketing paragraphs or extra slogans were added.

## Measured contrast

WCAG relative-luminance calculation, rounded to two decimal places:

| Foreground / background | Ratio |
| --- | --- |
| Ink / white | 12.52:1 |
| Muted / white | 5.35:1 |
| Muted / paper | 4.89:1 |
| White / fern primary action | 7.45:1 |
| Lime / forest navigation | 11.41:1 |
| Success / white | 7.16:1 |
| Warning / white | 6.45:1 |
| Danger / white | 6.80:1 |

These are selected token pairs, not a claim of complete accessibility
certification. Disabled controls, decorative borders and logos have different
roles. A screen-reader audit, Windows high-contrast mode and additional browsers
remain useful follow-up coverage.

## Verification

- Desktop sign-in, fleet, services, network, PowerShell editor, files, remote
  controls, recovery, Slide, activity, settings and enrollment inspected visually.
- Narrow sign-in, fleet, network and recovery inspected; page overflow checked
  separately from intentional scrolling inside cards, tabs and tables.
  The mobile fleet capture shows the keyboard-focused skip link. A later tablet
  check could not be completed because the browser viewport override stopped
  applying; no tablet result is claimed.
- Keyboard focus, field labels, main navigation, dialog dismissal, fleet search,
  no-results state and recovery content inspected in the browser.
- Windows amd64 agent and desktop helper, Linux amd64 and arm64 builds completed.
  Both Windows files have an embedded icon and the correct product descriptions.
- Windows installers successfully upgraded all three original Windows demo PCs;
  Linux installers successfully upgraded both original Linux demo servers.
  Services restarted successfully and all five devices reported online.
- Eight control-plane tests and three Linux agent tests passed. The existing
  end-to-end recovery evidence was retained; no recovery run was launched for
  this visual change. Linux arm64 was cross-built, not run on ARM hardware.
- The website and downloadable packages were deployed over HTTPS. The control
  plane was not restarted; its prior static release and endpoint binaries were
  retained privately for rollback.

A browser SSH session showed the real Linux agent help and installer about text.
Windows agent help and file properties were also checked. The product
remains an early single-administrator RMM; branding does not change the capability
or security limits documented in the main README.

## 0.2 fleet and remote upgrade — September 22, 2026

The current [gallery](screenshots/v0.2/README.md) replaces the card grid with a wide
fleet table and right-side device drawer. Screen/SSH and prompt actions are
visible in each row. Patches, software templates and AI have dedicated views.
The same brand tokens, Inter type and native icons remain in use. Sign-in dots
orbit slowly while the mark stays still; observed positions changed over time.

Desktop and 390×844 mobile layouts were inspected in the browser. A scrollbar
width bug that pushed the mobile drawer off the left edge was fixed by sizing it
to the available width. Tabs intentionally scroll horizontally. The table turns
into compact device rows on mobile; page-level overflow was not observed there.
Template editor, patch inventory, command panel and AI entry points were inspected.

Remote control now has its own full-frame workspace. Browser fullscreen entry
and exit, Windows+R, Escape, remote clipboard paste and Linux keystrokes were
exercised. A real Windows RDP session received audio output. Live Windows preview
capture succeeded in an active session; disabling the policy immediately removed
the frame. Locked/disconnected desktops correctly had no fresh frame.

A live-resize assertion in the deployed Guacamole/FreeRDP RDP path froze the
initial test session. Speck now explicitly selects a stable RDP resolution at
connection time and scales or scrolls it on the client. The final fullscreen test
kept the session interactive: Windows+R opened Run and clipboard paste populated
its input. SSH remains resizable. Runtime gateway crashes are a regression gate
for any future dynamic-RDP work; a pretty frozen screenshot is not a pass.

Verification: 15 Python tests, four native Linux Go tests, Windows amd64 and Linux
amd64/arm64 agent builds, TypeScript build, two desktop URL/origin tests, and CI
packaging on Windows/macOS/Linux passed. All five original agents were upgraded,
passed health templates, and completed native update scans. A package template
completed on both Linux machines. Real OpenAI script generation and bounded
computer-action proposals were exercised. A reviewed click opened the Windows
imaging application’s connection dialog; it was closed without changing settings. Source/clone identities, Slide links,
existing backups and retained recovery resources were preserved.

Native application interaction could not be verified because the operator Mac
was locked. Native clipboard synchronization and platform key interception are
implemented but are not claimed as interactively verified. Windows MSI and real
selected-update installation were not exercised on the active dental machines;
validation and command construction have automated coverage. Linux graphical
preview/audio, ARM execution, microphone input and additional browsers remain
unverified. Desktop downloads are preview packages; signing/notarization remains
on the [roadmap](ROADMAP.md).
