# Current state

Speck 0.2 is deployed at https://speckrmm.com. The fleet, operations, AI, previews
and full-frame remote workspace are implemented. Five original demo agents run
0.2.0; their Slide links and the retained recovery resources are preserved.

The public desktop preview packages build on Windows/macOS/Linux. Native UI
verification is still pending because the operator Mac was locked. Do not claim
shared clipboard or native key handling was interactively verified. The next
action is the native smoke-test matrix and signing/notarization before a stable
client release. Browser remote input, clipboard, fullscreen and reviewed AI
navigation were exercised. See `docs/ROADMAP.md` for remaining scope.

Integration branch: `codex/fleet-operations`. Server implementation deployed at
`bca89b6`; subsequent static copy cleanup is included in the final source release.
Private rollout evidence and rollback details: `output/fleet-review/`.
