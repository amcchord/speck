import { test } from "node:test";
import assert from "node:assert/strict";
import {
  disks,
  adapters,
  guestAddresses,
  percent,
  number,
  sparkline,
  chartPoints,
} from "../src/proxmox-model.ts";
test("Proxmox configuration exposes disks, optical media and network configuration", () => {
  const cfg = {
    scsi0: "local-lvm:vm-101-disk-0,size=64G,discard=on",
    ide2: "none,media=cdrom",
    rootfs: "local:101/rootfs,size=8G",
    net0: "virtio=02:00:00:00:01:02,bridge=vmbr0,tag=20",
    net1: "name=eth0,hwaddr=02:00:00:00:01:03,bridge=vmbr1,ip=192.0.2.1/24",
    description: "not a disk",
  };
  assert.equal(disks(cfg).length, 3);
  assert.equal(disks(cfg)[0].size, "64G");
  assert.equal(disks(cfg)[1].media, "CD/DVD");
  assert.deepEqual(adapters(cfg)[0], {
    key: "net0",
    model: "virtio",
    mac: "02:00:00:00:01:02",
    bridge: "vmbr0",
    vlan: "20",
    address: "",
  });
  assert.equal(adapters(cfg)[1].address, "192.0.2.1/24");
});
test("Guest results unwrap their envelope and keep usable IPv4 and IPv6", () => {
  assert.deepEqual(
    guestAddresses({
      result: [
        {
          "ip-addresses": [
            { "ip-address": "127.0.0.1" },
            { "ip-address": "::1" },
            { "ip-address": "fe80::1" },
            { "ip-address": "192.0.2.10" },
            { "ip-address": "2001:db8::1" },
          ],
        },
      ],
    }),
    ["192.0.2.10", "2001:db8::1"],
  );
});
test("Zero utilization is distinct from unavailable data, charts preserve missing samples", () => {
  assert.equal(percent(0, 100), 0);
  assert.equal(percent(null, 100), null);
  assert.equal(percent(4, 0), null);
  assert.equal(number(undefined), null);
  assert.deepEqual(chartPoints([{ cpu: 0 }, {}, { cpu: 0.1 }], "cpu", 100), [
    0,
    null,
    10,
  ]);
  assert.equal((sparkline([0, null, 10]).match(/M/g) || []).length, 2);
  assert.equal(sparkline([null, 1]), "");
});
