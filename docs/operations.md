# Fleet operations

Speck 0.2 keeps the fleet in a searchable, sortable table. Select a name for the
right-side drawer, **Screen/SSH** for a full-frame remote workspace, or **Prompt**
for PowerShell or a shell. Mobile keeps those actions visible in each device row.

## Live screen previews

In a device's Overview, turn on **Allow previews**. The fleet's **Live previews**
checkbox displays available thumbnails. Preview permission is separate for each
machine and defaults off, including restored candidates.

An interactive helper captures the first display at up to 640 pixels about every
10 seconds. Windows needs an active, signed-in desktop; Linux needs X11 and
`xprop`. Locked/disconnected sessions and headless/Wayland machines may have no
frame. Previews expire after 45 seconds, are memory-only on the server, and are
removed immediately when disabled. The helper's permission lease expires after
30 seconds without renewal. Preview images are not automatically sent to AI.

## Updates

Select online machines in **Patches**, then **Scan selected**. Windows uses the
Windows Update Agent; Linux uses apt or dnf and requires Python 3. A scan refreshes
repository metadata but does not install updates. Review a machine's inventory,
select updates, review the generated script, then run the installation.

Installations require a scan less than 24 hours old. They install selected
software updates, not drivers, and do not request a reboot. Windows installations
accept the selected updates' license terms; the review screen states this before
submission. Linux package dependencies may also be updated. Reboot reporting on
Linux currently uses `/var/run/reboot-required`; not every distribution creates it.
There are no unattended patch policies, maintenance windows, or automatic
reboots. Inventory shows at most 150 updates; rescan after installing a batch.

## Software and scripts

**Software & scripts** contains reusable, versioned templates with named inputs.
Start with Windows/Linux health checks, an HTTPS + SHA-256 Windows MSI installer,
or an apt/dnf package installer. Customize a starter to save your own copy.
Scripts receive inputs through `SPECK_PARAM_NAME` environment variables; the
server quotes each value for its target shell.

Choose a template, fill its inputs, select machines, and review the exact targets,
scripts and time limits. An operation has one result per machine. Request IDs
prevent accidental duplicate submissions. Offline, unapproved, incompatible or
outdated agents are rejected before any job is queued. Cancelling an operation
cancels queued jobs only. Running installers continue; unknown outcomes require
inspection and are not automatically retried. Up to 500 targets and two-hour
command limits are supported. Scheduling and automatic rollback are not included.

## AI assistance

Configure a server-side OpenAI key in **Settings** or `OPENAI_API_KEY`; the default
model is `gpt-5.4-mini`, configurable through Settings or `SPECK_AI_MODEL`.
The key never reaches the browser. Stored settings and template scripts are
encrypted with the server's existing encryption key.

Ask for scripts or help diagnosing an issue. Health context is opt-in and limited
to OS, utilization and service names/status. Review a draft, then copy it into
the terminal or a template. AI has no job-execution tool.

The remote workspace's **Screen assistant** sends the displayed screen and your
request to OpenAI when invoked. It can explain the screen or propose a small
computer-use step. Review and explicitly apply every step. Coordinates, keys and
action counts are bounded; unsupported or sensitive steps require manual control.
A changed screenshot invalidates a proposed step. The initial screenshot-only
computer-tool exchange is fulfilled without input to the machine. No subsequent
action runs automatically. Screens can contain sensitive information: the UI
explains what is sent before the request. Responses use `store:false`; provider
retention policies still apply. Audit entries retain request metadata, not prompts
or screenshots. Ten requests per minute per operator are allowed.

Implementation follows OpenAI's [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
and [computer-use protocol](https://developers.openai.com/api/docs/guides/tools-computer-use).

## Remote workspace and desktop client

Remote access fills its own page. Fullscreen preserves the control bar and fits the image without cropping.
RDP uses a stable resolution selected at connection time (at least 1600×900);
SSH terminals resize with the workspace. This avoids a live-resize crash in the
deployed Guacamole/FreeRDP gateway. **View at 100%** enables scrolling at native scale. Key shortcuts include
Ctrl+Alt+Del, Windows+R, Alt+Tab and Task Manager. Touch input maps to the remote
screen. Clipboard controls remain available in the browser.

[Download Speck Desktop](https://github.com/amcchord/speck/releases) for Windows
x64, macOS Apple silicon/Intel, or Linux x64. Install and open it once, then sign
in with the same Speck account. Select **Speck Desktop** in Settings → Remote
client, or use **Open in desktop app** during a session. Future launches use
`speck://connect/<machine-id>`; links contain no passwords or session tokens.
Browsers cannot reliably detect installed applications, so an explicit browser
fallback remains available. Each client's authenticated session is independent.

Enable **Shared clipboard** per remote session to synchronize plain text while
the native client is focused. It starts off, caps text at 64 KiB, and never reads
files or images from the clipboard. The native Session menu offers key macros
and F11 fullscreen. Microphone use asks for permission.

Desktop 0.2.1 includes fixes verified on macOS Apple silicon and Windows 11.
The Mac packages are Developer ID signed, Apple-notarized and stapled. Windows
packages remain unsigned. Linux native graphical interaction, Intel Mac execution
and physical microphone round trips remain unverified; see the
[qualification matrix](desktop-quality.md). Browser access remains available
without a native download. This client targets `https://speckrmm.com`; self-hosters
can rebuild with their own exact origin in `desktop/policy.cjs`.

## Build the desktop application

```sh
npm --prefix desktop ci
npm --prefix desktop test
npm --prefix desktop run build
```

Use the target OS for packaging. CI builds macOS DMG/ZIP, Windows NSIS and Linux
AppImage/DEB packages. The desktop application is distinct from the small
`speck-desktop.exe` observation helper installed on managed Windows endpoints.
