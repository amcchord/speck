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

For a single-NIC Windows restore, see
[`windows-recovery-network.ps1`](windows-recovery-network.ps1). It changes the
address in one operation and schedules a DHCP rollback if the restored machine
cannot reach a supplied health URL. Adapt the adapter selection and addressing
to your application. Do not disable DHCP and then assume its old address still
exists: that intermediate state can strand the RMM before a proof command runs.

## Automatic Fleet cleanup

Speck polls the connected Slide API every five minutes. It links a restored
endpoint only when its interface MAC matches exactly one Slide test/disaster VM,
its installation credential matches a distinct original linked to that VM's
protected agent, and both hardware identities are unambiguous. This also works
for restores created outside Speck, provided Speck observes them before removal.
Backup-verification VMs are excluded.

After a linked VM disappears from complete provider inventory, Speck checks its
exact restore URL. Two HTTP 404 observations at least five minutes apart, plus
an offline endpoint and unchanged source/clone identity, allow automatic
archiving. An offline endpoint alone, a stopped VM, incomplete inventory, denied
access, a rate limit, or a server/network error is insufficient. Changing the
provider origin or API token requires observing the VM again before automatic
cleanup can use that connection.

Archived copies leave the default Fleet and their alerts/queued management are
closed. Audit records, recovery reports, jobs and the original machine remain.
The shared installation credential is never revoked. An archived clone that
checks in again remains archived and cannot receive commands. Administrators
can turn automatic archiving off under **Slide → Restored machine cleanup**;
operators can use **Check now**. Archived entries remain available through the
existing device-history controls/API. A restore already deleted before Speck
first observed it requires ordinary manual archiving.

Fleet's **Refresh** button also checks the connected Slide account for removed
restores before reloading inventory for operators and administrators. This uses
the same confirmation window and automatic-archiving policy as **Check now**;
it does not shorten the five-minute grace period. Pending confirmations are
reported, and a cleanup failure still allows inventory to refresh. Viewer refreshes,
normal navigation and background Fleet updates do not trigger cleanup. Scheduled
checks continue every five minutes.

This process archives Speck entries only. It does not delete VMs, snapshots or
recovery networks in Slide. Remove an unwanted test VM in Slide; its linked
Speck entry is cleaned up after the confirmation window. Retain any evidence
needed before removing a test VM's writable disks.
