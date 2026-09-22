# Speck screenshots

**[Machine overview](machine-overview/README.md)**: compact machine facts, a 16:9 preview and health information above the fold.

**[Headless web shell](web-shell/README.md)**: interactive Linux terminal, scrollback search and responsive controls (not yet deployed).

**[Visual audit](visual-audit/README.md)**: consistent controls, cleaner icons, responsive pages and full-width native sign-in.

**[Fleet row and pane](fleet-row-pane/README.md)**: row-wide activation, persistent context and mobile details.

**[Compact Fleet](compact-fleet/README.md)**: dense desktop rows, OS icons, Safari and mobile.

**[Passkeys](passkeys/README.md)**: web, mobile enrollment, account controls and native Mac sign-in.

**[iPhone & iPad](ios/README.md)**: native fleet, commands, recovery and adaptive layouts.

**[Loading states](loading/README.md)**: immediate progress on desktop, mobile and machine details.

**[Desktop downloads](downloads/README.md)**: installers in the console and on the sign-in page.

**[Open the current 0.2 gallery](v0.2/README.md)**: fleet table, device drawer,
patching, templates, AI, mobile layouts and full-frame remote access.

The captures below document the initial 0.1 identity release; fleet and remote
layouts have since changed.

A curated tour of the actual Speck console, its shared identity and its agents.
Click any image for the full-resolution JPEG. All images are unretouched browser
captures; none are generated UI mockups.

The console gallery uses the real production frontend with deterministic,
synthetic **Brace Yourself Dental** data from `scripts/preview.py`. Public network
examples use documentation-only addresses. Agent/installer captures are from the
actual isolated dental demo machines through Speck. No credentials or patient
records are included. The illustrated recovery report is a fixture, not a new
recovery test result; see the working record for live validation.

## Identity and sign-in

| Brand system | Desktop sign-in |
| --- | --- |
| [![Speck brand sheet](00-brand.jpg)](00-brand.jpg) | [![Desktop sign-in](01-sign-in.jpg)](01-sign-in.jpg) |

## Monitoring and administration

| Fleet overview | Services |
| --- | --- |
| [![Fleet overview](02-fleet.jpg)](02-fleet.jpg) | [![Service status and controls](03-services.jpg)](03-services.jpg) |

| Network | PowerShell |
| --- | --- |
| [![Network inventory](04-network.jpg)](04-network.jpg) | [![PowerShell command editor](05-terminal.jpg)](05-terminal.jpg) |

| Files | Browser access |
| --- | --- |
| [![File transfers](06-files.jpg)](06-files.jpg) | [![Remote access controls](07-remote.jpg)](07-remote.jpg) |

## Recovery and operations

| Recovery lab | Slide inventory |
| --- | --- |
| [![Recovery evidence](08-recovery.jpg)](08-recovery.jpg) | [![Slide protection](09-slide.jpg)](09-slide.jpg) |

| Activity | Settings |
| --- | --- |
| [![Jobs and audit trail](10-activity.jpg)](10-activity.jpg) | [![Connection settings](15-settings.jpg)](15-settings.jpg) |

[![Device enrollment](11-enrollment.jpg)](11-enrollment.jpg)

## Small screens

| Sign-in | Fleet with keyboard focus | Recovery |
| --- | --- | --- |
| [![Mobile sign-in](12-mobile-sign-in.jpg)](12-mobile-sign-in.jpg) | [![Mobile fleet](13-mobile-fleet.jpg)](13-mobile-fleet.jpg) | [![Mobile recovery](14-mobile-recovery.jpg)](14-mobile-recovery.jpg) |

## Agents and installers

| Linux agent | Linux installer |
| --- | --- |
| [![Speck Agent help](16-linux-agent.jpg)](16-linux-agent.jpg) | [![Linux installer information](17-linux-installer.jpg)](17-linux-installer.jpg) |

[![Windows agent help](18-windows-agent.jpg)](18-windows-agent.jpg)

These show non-mutating help/about commands after successful upgrades. Native
terminal typography follows the operating system. Both Windows executables also
contain the shared multi-size icon and branded file properties.

## Refresh the gallery

```sh
./scripts/build.sh
python3 scripts/preview.py
```

Open `http://127.0.0.1:8741`. Enter any nonempty demo username and password: this
loopback-only preview has no real authentication, database, agent or provider
connection. Its sign-in and enrollment demonstrations are synthetic; other writes
are rejected. Never deploy it or bind it to a public interface.

1. Capture sign-in, then select `BYD-FRONTDESK` for the device pages.
2. Capture each main navigation page. Do not expand raw credential/provider data.
3. For the terminal screenshot, enter a harmless example without submitting it.
4. Open **Add a device** without creating an enrollment.
5. Check narrow layouts at 390×844 and a tablet at 1024×768. Restore the normal
   viewport when done. Most desktop captures use the normal 1280px browser width
   with full-page capture so tables and controls remain visible.
6. Capture `/brand/index.html` for the visual brand sheet.
7. Capture actual agent help only after verifying there are no secrets, private
   addresses, unrelated windows or user records visible. Preserve truthful output.
8. Review the captures, update the manifest and [UI review](../ui-review.md), and commit
   screenshots with their corresponding UI changes. Do not retouch screenshots.

The [capture manifest](manifest.json) records dimensions, SHA-256 digests and provenance. Live
operational evidence and before screenshots stay in ignored `output/`.

[Saved desktop previews](previews/README.md) show the last saved timestamp and desktop recovery guidance on desktop and mobile.
