# Speck roadmap

## Delivered in 0.2

- [x] Wide fleet table and right-side device drawer.
- [x] Direct screen/SSH and prompt actions.
- [x] Per-machine opt-in live previews with expiration and immediate removal.
- [x] Windows/Linux update inventory and reviewed installation.
- [x] Versioned software/script templates and bulk execution.
- [x] OpenAI scripting and operator-reviewed screen assistance.
- [x] Desktop/mobile layouts and subtle reduced-motion-aware sign-in orbits.
- [x] Full-frame remote workspace, fullscreen, fit/100% and key shortcuts.
- [x] macOS/Windows/Linux operator-client packages and browser fallback.
- [x] Native shared-clipboard implementation, off by default per session.

## Release follow-ups

- [ ] Interactive native-client verification on all three operating systems.
      The initial local macOS run was blocked by a locked operator workstation.
      Packaging and protocol/origin tests pass; native clipboard and shortcut
      smoke tests remain necessary before a stable client release.
- [ ] Windows code signing and macOS signing/notarization for distributed builds.
- [ ] Re-enable dynamic RDP resolution after qualifying a gateway version that
      passes repeated resize/fullscreen checks. Current RDP uses stable resolution.
- [ ] Live Windows MSI installation and selected-patch installation validation
      on disposable targets; native scans and Linux package deployment are verified.
- [x] Reviewed scheduled templates and Windows/Linux patch scans with durable history.
- [x] Persistent health/service/job alerts, maintenance, sites/tags and retirement.
- [x] Optional authenticator MFA, admin/operator/viewer roles and audit filtering.
- [ ] Patch maintenance windows/reboots and scheduled recoveries.
- [ ] SSO, required organization-wide MFA, signed automatic agent updates and security review.
- [ ] Installed-software inventory, external alert escalation and supported retention cleanup.

The management additions are validated locally and await coordinated deployment;
see [MVP review](MVP-REVIEW.md) and the [management guide](management.md).
