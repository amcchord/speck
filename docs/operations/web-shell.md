# Headless web shell

Status: implemented and locally verified on `codex/headless-webshell`, based on
main `b6dfb32` (including the latest machine overview, preview and restore-lifecycle changes). Not deployed. No production agents, credentials or services changed.

## Behavior

The Fleet screen action and machine Remote page open an interactive web shell for
Linux agents that advertise `web_shell` and report no desktop. An agent without a
saved remote connection can also use the shell immediately. An unknown display
state preserves configured RDP/VNC; an existing SSH connection defaults to the
web shell unless a desktop is positively reported. Old agents retain their saved
connection behavior. Windows continues using its configured desktop connection.

The Linux agent detects X11 and Wayland sessions using logind's runtime records
and checks X sockets. Locked sessions and greeters count as graphical. Missing
logind information is unknown, not proof of a headless machine. The service's
`DISPLAY` environment and missing active-window telemetry are not used as proof.

The terminal uses xterm.js with 10,000 lines of scrollback, search, selection copy,
explicit paste, adjustable font size, responsive terminal resizing, shell key
shortcuts, fullscreen, disconnect and reconnect. Reconnect creates a fresh shell;
it does not replay commands. Ctrl+C interrupts remote programs. Cmd+C/V and
Ctrl+Shift+C/V provide clipboard shortcuts. Ctrl+Shift+F searches scrollback.
Screen reader support is optional; enabling it uses xterm’s accessibility mode.
Default mode supports Unicode/emoji and mobile insert-text events.
Desktop-only sound, microphone and Windows shortcuts are absent. The saved
RDP/SSH/VNC connection is retained and available through the terminal footer.

The shell runs as the agent service account (normally root), using a real Linux
PTY and Bash with `/bin/sh` fallback. There is no SSH daemon, password, key or
Guacamole dependency for this path. Commands intentionally detached by the
operator are not a persistent session managed by Speck.

## Session and security boundaries

The existing operator/admin role, CSRF, same-origin WebSocket, approved hardware
identity, per-session agent secret and single browser claim all apply. Sessions
share the existing four-per-user limit and end at the earlier of two hours or
the authenticated session expiry. Logout, account revocation and device retirement
close the same session registry. A cancelled pending session cancels its queued
shell job. Agent journal markers prevent replay after restart.

Output uses bounded queues and acknowledgement after terminal rendering, so slow
browsers do not accumulate unlimited output. Only input and resize messages are
accepted. Session start/end metadata is audited; terminal contents are not saved
in jobs, audit, browser storage or the database. The server relays plaintext in
memory inside authenticated TLS connections. A fresh shell inherits a minimal
environment rather than the agent service's environment. Its login files and
commands retain the agent account's normal privileges.

Closing a session closes the PTY and socket, stops its worker goroutines, kills
the shell process group and reaps the shell. The PTY descriptor remains pollable
during resize so a blocked read can be interrupted on disconnect.

## Verification

- Backend suite: 104 tests pass, including 22 shell cases. Covers capability selection, old agents, GUI and
  unknown states, explicit connection override, offline/unapproved devices,
  viewer/other-owner/origin rejection, wrong agent/secret, single claim, duplex
  Unicode, resize/input bounds, logout, queued cancellation, session cap and expiry.
- Linux container: `go test -race ./internal/agent` passes. A real PTY over TLS
  WebSocket verifies shell execution, Unicode, resize, Ctrl+C, removal of inherited
  environment variables and closing while a foreground command runs.
- Linux amd64/arm64 and Windows amd64 agent cross-builds pass.
- TypeScript/Vite build, 28 web unit tests and 80 browser checks pass.
  Chromium and WebKit cover all existing pages plus the terminal at 1440/390/320px,
  typed input, shortcuts, search, resize, reconnect and leaving during creation.
- iOS simulator build passes with the updated Web shell label and terminal icon.
  Native physical-device shell/clipboard acceptance has not been performed.
- Screenshots use synthetic terminal output against the actual built frontend.
  See [gallery](../screenshots/web-shell/README.md). No live endpoint was contacted.

## Release order

This is a coordinated server/web/Linux-agent release, not a static-only update.
After release authorization, preserve the current server/web and agent binaries,
check for active sessions/jobs, then release matching server and web assets before
upgrading Linux agents. Confirm a fresh telemetry report advertises `web_shell`.
There is no database schema migration and no remote credential rewrite.

Acceptance should open the Fleet screen action on a headless Linux endpoint,
exercise `pwd`, Unicode, terminal resize, Ctrl+C, exit/reconnect and a tab close,
then confirm ordinary Windows RDP and a configured Linux graphical session still
open normally. Use a disposable endpoint for command acceptance. Revalidate
approval/retirement and logout teardown with a disposable operator account.

Rollback server/web together and restore previous agent binaries if necessary.
Existing RDP/SSH/VNC credentials remain available. Updating only the web cannot
activate the feature on a legacy server/agent; native installers do not need
repackaging to load the shared web terminal. The iOS label change can ship with
the next separately authorized native release.
