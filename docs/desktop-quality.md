# Speck Desktop 0.2.1 qualification

The 0.2.1 desktop update fixes failures found in real macOS and Windows use.
It is a focused remote-workspace release; it does not imply that every RMM
capability or platform combination has passed production qualification.

## Fixed through native testing

- Await Electron's asynchronous clipboard APIs. Previously, reading the native
  clipboard failed with a `.slice is not a function` error.
- Route Command/Ctrl editing shortcuts to the remote machine when its display
  has focus, while retaining normal editing in local form fields. Command+V on
  a Mac no longer opens Windows clipboard history.
- Use native window fullscreen, preserve remote Escape, restore display focus,
  and keep the full-screen button synchronized with native window events.
- Reopen a closed Mac window when the browser hands it a Speck session link.
- Track Guacamole connection state through its supported events so audio
  reception statistics update correctly. Add an explicit sound toggle.
- Own microphone tracks, worklet, context and stream, releasing all resources on
  mute, disconnect, rejection and late permission completion. Missing hardware
  and denied permission have actionable messages.
- Wait for the remote application to open its recording device instead of
  falsely timing out idle microphone input. Normal recording closure returns to idle.
- Use the shared Speck artwork in the assisted Windows installation wizard.

## Evidence and scope

| Platform or check | Result |
| --- | --- |
| macOS Apple silicon: launch, login, retained session | Passed interactively |
| macOS: Windows RDP, Unicode clipboard both ways, Command editing | Passed interactively |
| macOS: fullscreen, remote Escape and closed-window browser handoff | Passed interactively |
| macOS: Linux SSH and keyboard command execution | Passed interactively |
| macOS: incoming audio | Transport bytes observed; subjective sound quality unverified |
| macOS: microphone | Missing-input failure verified; this Mac has no input device |
| macOS Intel | Signed/notarized package; not executed on Intel hardware |
| Windows x64 | Installed and upgraded on Windows 11; RDP, clipboard and keyboard exercised |
| Windows x64: microphone | Synthetic Chromium input reached a recording in the remote Windows session; physical hardware remains unverified |
| Linux x64 desktop client | AppImage/deb built in CI; native graphical interaction not yet exercised |
| Automated regression coverage | 10 desktop tests and 7 microphone lifecycle tests passed |
| Build checks | TypeScript production build and three-platform package CI passed |

Both Mac architectures are Developer ID signed, notarized by Apple and stapled.
Gatekeeper assessment reports `Notarized Developer ID`. Windows remains unsigned.
No physical end-to-end microphone, call-quality, Linux graphical/audio, or Intel
Mac runtime result is claimed. Some final Mac checks stopped when the workstation
locked again. Stable RDP resolution remains intentional; fit and 100% modes avoid
the gateway resize assertion identified during 0.2 testing.

Private session evidence and signing receipts stay in ignored
`output/desktop-quality/`. Public screenshots must contain synthetic data only.
A synthetic microphone probe recorded 143,515 mono 8-bit samples at 11,025 Hz
on the remote Windows endpoint (nonzero RMS 11.7624). This validates transport,
not physical hardware or subjective speech quality. Test-only Chromium flags
were used for that launch and are absent from the packaged application.

Original devices, Slide identities and retained recovery resources are preserved.

## Passkeys — Desktop 0.2.2, September 22, 2026

[Release 0.2.2](https://github.com/amcchord/speck/releases/tag/v0.2.2) contains seven
installers/archives and SHA256SUMS. Both Mac architectures include the Developer ID
provisioning profile required by the app’s Touch ID keychain entitlement. They are
signed, notarized and stapled, and Gatekeeper accepts both. An initial notarized
build without the profile could not launch; it was rejected before publication.
The signing hook now prevents that release mistake. Explicitly unsigned CI builds
remain supported.

The final Apple silicon application launches, preserves the prior login, displays
the new sign-in controls, opens a matching-code Safari passkey handoff and cancels
cleanly. The handoff never receives the desktop’s verifier or resulting session.
Fourteen desktop tests pass, including origin/frame validation, account selection,
and browser-opening IPC; all three platform CI packaging jobs pass. Windows/Linux
installers are rebuilt, but new passkey runtime ceremonies on those platforms and
physical Mac Touch ID/provider acceptance remain open. The previous remote-media
qualification and its limits above still apply. Windows remains unsigned.

## Automatic updates — Desktop 0.2.3

All seven packages were rebuilt from runtime `68de4bd` and published with the
three update manifests and blockmaps. Both Mac apps pass strict codesign,
notarization/staple validation and Gatekeeper. Nineteen native desktop tests and
all platform packaging jobs pass. An isolated signed bootstrap version downloaded
the final Apple silicon ZIP, passed native Squirrel verification, installed it on
normal quit and relaunched as 0.2.3. The real packaged app reported current against
the public GitHub release. Feed checks covered Windows and Linux x64 as well.

Windows/Linux update installation and Intel Mac execution are not yet qualified.
Windows remains unsigned. See [updater operations](operations/desktop-updates.md).
