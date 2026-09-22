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

- [x] Interactive macOS Apple silicon and Windows native-client smoke tests.
      See [0.2.1 qualification](desktop-quality.md) for results and limits.
- [x] Developer ID signing and Apple notarization for both Mac architectures.
- [ ] Linux graphical client and Intel Mac runtime verification.
- [ ] Physical microphone round-trip and subjective call-quality verification.
- [ ] Windows code signing.
- [ ] Re-enable dynamic RDP resolution after qualifying a gateway version that
      passes repeated resize/fullscreen checks. Current RDP uses stable resolution.
- [ ] Live Windows MSI installation and selected-patch installation validation
      on disposable targets; native scans and Linux package deployment are verified.
- [x] Reviewed scheduled templates and Windows/Linux patch scans with durable history.
- [x] Persistent health/service/job alerts, maintenance, sites/tags and retirement.
- [x] Optional authenticator MFA, admin/operator/viewer roles and audit filtering.
- [ ] Patch maintenance windows/reboots and scheduled recoveries.
- [x] Signed automatic Windows/Linux agent updates, idle deferral and rollback.
- [ ] SSO, required organization-wide MFA and security review.
- [ ] Installed-software inventory, external alert escalation and supported retention cleanup.

The management additions are deployed and passed live Windows/Linux scan and
management acceptance on September 22, 2026;
see [MVP review](MVP-REVIEW.md) and the [management guide](management.md).
