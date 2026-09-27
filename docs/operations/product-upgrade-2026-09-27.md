# Product upgrade implementation record

Authorized scope: the 22 items in [the product review](product-review-2026-09-27.md), including production deployment. This record tracks implementation and verification; unchecked items are not delivered.

Release owner: the connected-workspace task in the primary checkout. Baseline: production `6a70fc8`, index `23fb80017807254494ae9a44da02dbe7feff907d74309b1fecebc3ad37e64986`. Private snapshots, deployment records and customer-bearing verification belong under ignored `output/product-upgrade/`.

## Delivery checklist

- [ ] 01 Evidence-based summaries
- [ ] 02 Progressive Home and safe metadata caching
- [ ] 03 Resource navigation, history and deep links
- [ ] 04 Shared operation results
- [ ] 05 Patch posture and remediation
- [ ] 06 Recovery readiness and proof
- [ ] 07 Integration configuration and health
- [ ] 08 Alert investigation and grouping
- [ ] 09 Schedule lifecycle
- [ ] 10 Template discovery and software inventory
- [ ] 11 Service, process and disk inspection
- [ ] 12 Machine network investigation
- [ ] 13 Equipment diagnostics and bounded history
- [ ] 14 DNS and reachability paths
- [ ] 15 Provider performance and relationships
- [ ] 16 Backup coverage and history
- [ ] 17 Fleet identity and coverage
- [ ] 18 Global command palette
- [ ] 19 Credential usage and rotation context
- [ ] 20 Access and agent administration
- [ ] 21 Files and remote sessions
- [ ] 22 Shared list/detail conventions

## Validation and rollout

Implement trust/navigation first, then operational workflows, integration detail and shared discovery. Validate actual Windows/Linux capabilities separately. Use real observations for history and explicit unavailable states for unsupported provider fields. Preserve existing action reviews and recovery isolation. Run relevant local backend, agent, platform, unit and browser checks before release. Fetch main and verify ancestry before each production build; compare live baseline under the release lock immediately before publishing. Record any remaining limitations and the verified release here and in WORKBOOK.md.
