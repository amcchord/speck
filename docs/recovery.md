# Recovery operation

Speck uses the [Slide public API](https://api.slide.tech) and the account scope of
its configured API token. Its inventory reads follow pagination (50 rows/page),
retry rate-limited reads, and remove password/private-key fields. Provider writes
are never automatically retried. A lost response can mean a resource exists even
though Speck did not receive its ID.

A recovery plan lists source Speck devices, corresponding Slide agents, target
restore appliances, CPU/RAM, proof commands, and a private subnet. Each run:

1. Executes the source's baseline command and retains its job and complete output.
2. Requests fresh backups and records each provider backup ID before polling.
3. Waits for successful snapshots and validates their source agent IDs.
4. Creates a uniquely named `standard` Slide network, with no LAN bridge.
   Restored machines share that network and have Internet access for Speck.
5. Waits for each snapshot to be present on its selected restore appliance,
   including cloud replication when a cloud target is selected.
6. Creates VMs attached only to the run's recorded network.
7. Waits for the operator to identify and approve the new instances.
8. Runs recovery checks against those instances and compares complete output.

Plans with run history cannot be edited, so prior reports continue to refer to
the commands actually used. Create a new plan version when changing checks.
Only one active/attention-required run can exist at a time in this release.

## Preparing applications

Restore networking is part of recovery. A replaced NIC may lose its static
address, while Linux network configuration may match the original MAC. Prepare
Linux configuration to recognize its recovered interface. A Windows recovery
command can reapply its application IP before testing dependent applications.
Use a separate private WireGuard subnet if clients outside the recovered group
need access; avoid overlapping routes on surviving client machines.

Proof should include application identity, data counts or hashes, database
integrity, real image/file hashes, and cross-machine service calls. A successful
Slide boot screenshot is useful infrastructure evidence but does not replace
application checks. On the phone system, separately test extension registration,
internal calls, and external routing when the recovery network is ready.

## Attention states and cleanup

Speck records a pending mutation before submitting it to Slide. On a failed or
lost response, inspect the provider for an already-created resource. Never blindly
restart the run: that can create duplicate VMs or networks. This release retains
the journal but does not provide automatic reconciliation or resume.

Stopping a run only stops VMs whose IDs were recorded by that run. Original
machines and snapshots remain untouched. The isolated network and stopped VMs
remain allocated. Review and remove them explicitly in Slide when no longer
needed. Unknown resources from ambiguous operations must be reconciled there.

Read [Slide's network documentation](https://docs.slide.tech/networks/) for
WireGuard peer configuration and [restore documentation](https://docs.slide.tech/restores/)
for appliance capacity, virtualization and recovery access.
