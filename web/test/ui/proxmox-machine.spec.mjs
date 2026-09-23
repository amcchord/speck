import { test, expect } from "@playwright/test";
const GiB = 1024 ** 3;
const resource = {
  id: "101",
  name: "Clinic server",
  provider: "proxmox",
  kind: "qemu",
  connection_id: "c1",
  connection_name: "Example cluster",
  node: "pve-2",
  status: "running",
  max_memory: 8 * GiB,
  management: "provider_only",
};
const machine = {
  id: "provider-101",
  label: resource.name,
  hostname: resource.name,
  has_endpoint_agent: false,
  has_speck_agent: false,
  state: "running",
  online: true,
  client_name: "Example Clinic",
  location: "Example cluster · pve-2",
  kind: "qemu",
  provider: "proxmox",
  telemetry: {},
  resources: [resource],
};
const detail = {
  resource,
  status: {
    status: "running",
    cpu: 0.124,
    mem: 2.5 * GiB,
    maxmem: 8 * GiB,
    cpus: 4,
    uptime: 187260,
  },
  configuration: {
    cores: 4,
    sockets: 1,
    cpu: "host",
    memory: 8192,
    bios: "ovmf",
    scsihw: "virtio-scsi-single",
    onboot: 1,
    agent: "1",
    ostype: "l26",
    scsi0: "local-lvm:vm-101-disk-0,size=64G",
    net0: "virtio=02:00:00:00:01:02,bridge=vmbr0,tag=20",
    tags: "production;clinic",
  },
  recent_tasks: [
    {
      type: "qmstart",
      status: "OK",
      starttime: 1790145600,
      endtime: 1790145604,
    },
  ],
  checked_at: 1790169600,
  capabilities: {
    guest_agent: true,
    guest_agent_config_known: true,
    console: { available: true },
  },
};
const guest = {
  state: "available",
  sections: {
    os: {
      state: "available",
      data: { result: { "pretty-name": "Debian GNU/Linux 13" } },
    },
    network: {
      state: "available",
      data: {
        result: [
          {
            name: "eth0",
            "hardware-address": "02:00:00:00:01:02",
            "ip-addresses": [{ "ip-address": "192.0.2.10", prefix: 24 }],
          },
        ],
      },
    },
    filesystems: {
      state: "available",
      data: {
        result: [
          {
            mountpoint: "/",
            type: "ext4",
            "used-bytes": 12 * GiB,
            "total-bytes": 64 * GiB,
          },
        ],
      },
    },
  },
};
const instruction = (...v) =>
  v.map((x) => `${String(x).length}.${x}`).join(",") + ";";

async function setup(page, options = {}) {
  const calls = [],
    input = [],
    deleted = [];
  let next = 0;
  await page
    .context()
    .addCookies([
      { name: "speck-gallery", value: "1", url: "http://127.0.0.1:8761" },
    ]);
  const png = await page.evaluate((blackFrame) => {
    const c = document.createElement("canvas");
    c.width = 960;
    c.height = 540;
    const g = c.getContext("2d");
    g.fillStyle = "#152d44";
    g.fillRect(0, 0, 960, 540);
    g.fillStyle = "#0d1924";
    g.fillRect(0, 0, 960, 32);
    g.font = "14px sans-serif";
    g.fillStyle = "#b6cadd";
    g.fillText(
      "Activities                                       Clinic server · Example screen",
      20,
      21,
    );
    g.fillStyle = "#111d27";
    g.fillRect(100, 110, 760, 300);
    g.fillStyle = "#dbe6ec";
    g.font = "19px monospace";
    [
      "Debian GNU/Linux 13",
      "",
      "clinic-server login: _",
      "",
      "192.0.2.10  ·  eth0",
    ].forEach((s, i) => g.fillText(s, 130, 152 + i * 42));
    if (blackFrame) {
      g.fillStyle = "#000";
      g.fillRect(0, 0, c.width, c.height);
    }
    return c.toDataURL("image/png").split(",")[1];
  }, options.blackFrame);
  await page.route(/\/api\/fleet(?:\?.*)?$/, (r) =>
    r.fulfill({ json: { machines: [machine], connections: [] } }),
  );
  await page.route("**/api/infrastructure/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data = {};
    if (path.endsWith("/inventory"))
      data = {
        connections: [
          {
            id: "c1",
            name: "Example cluster",
            provider: "proxmox",
            status: "connected",
            resources: [resource],
          },
        ],
      };
    else if (path.endsWith("/connectors")) data = [];
    else if (path.endsWith("/catalog"))
      data = {
        reboot: { label: "Reboot", method: "POST", danger: true, fields: [] },
        stop: { label: "Force stop", method: "POST", danger: true, fields: [] },
        "snapshot-create": {
          label: "Create snapshot",
          method: "POST",
          fields: [],
        },
      };
    else if (path.endsWith("/guest"))
      data = options.noGuest
        ? { state: "unavailable", message: "Guest agent is not responding." }
        : guest;
    else if (path.includes("/resources/"))
      data = options.stopped
        ? {
            ...detail,
            resource: { ...resource, status: "stopped" },
            status: { status: "stopped" },
            capabilities: {
              guest_agent: false,
              guest_agent_config_known: true,
              console: {
                available: false,
                reason: "Start the virtual machine to view its screen.",
              },
            },
          }
        : detail;
    else if (path.endsWith("/console")) {
      calls.push(route.request().postDataJSON());
      if (options.busy) {
        await route.fulfill({
          status: 409,
          json: {
            detail:
              "This provider console is already open; close it before reconnecting",
          },
        });
        return;
      }
      if (options.late)
        await new Promise((resolve) => setTimeout(resolve, 800));
      data = { id: "pve-session-" + ++next, protocol: "vnc" };
    } else if (path.endsWith("/metrics"))
      data = Array.from({ length: 20 }, (_, i) => ({
        time: 1790168400 + i * 60,
        cpu: 0.05 + (i % 6) / 100,
        mem: GiB * (2 + i / 100),
        netin: i * 2000,
        netout: i * 1000,
        diskread: 15000,
        diskwrite: 4000,
      }));
    else if (path.endsWith("/snapshots"))
      data = [
        {
          name: "before-update",
          snaptime: 1790145600,
          description: "Before OS maintenance",
          vmstate: 0,
        },
        { name: "current" },
      ];
    await route.fulfill({ json: data });
  });
  await page.route("**/api/remote/sessions/pve-session-*", async (route) => {
    deleted.push(route.request().url());
    await route.fulfill({ json: { ok: true } });
  });
  await page.routeWebSocket(
    /\/api\/remote\/sessions\/[^/]+\/ws(?:\?.*)?$/,
    (ws) => {
      ws.onMessage((message) => input.push(String(message)));
      if (options.hung) return;
      ws.send(instruction("", "test"));
      ws.send(instruction("size", 0, 960, 540));
      const frame = () => {
        ws.send(instruction("img", 1, 14, 0, "image/png", 0, 0));
        ws.send(instruction("blob", 1, png));
        ws.send(instruction("end", 1));
        ws.send(instruction("sync", 1234));
      };
      if (options.initialSync) {
        ws.send(instruction("sync", 1233));
        setTimeout(frame, 500);
      } else frame();
    },
  );
  await page.goto("/");
  await page.locator('[data-row="provider-101"] .machine-name').click();
  return { calls, input, deleted };
}
for (const blackFrame of [false, true])
  test(`preview waits for painted pixels after the initial size/sync (black=${blackFrame})`, async ({ page }) => {
    const state = await setup(page, { initialSync: true, blackFrame });
    const preview = page.locator(".pve-preview-screen img");
    await expect(preview).toBeVisible();
    const pixel = await preview.evaluate(async (img) => {
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return [...ctx.getImageData(100, 100, 1, 1).data];
    });
    expect(pixel).toEqual(blackFrame ? [0, 0, 0, 255] : [21, 45, 68, 255]);
    await expect.poll(() => state.deleted.length).toBe(1);
    expect(state.input.some((m) => m.startsWith("3.key") || m.startsWith("5.mouse"))).toBe(false);
  });
for (const width of [1440, 390])
  test(`Proxmox overview, capture, inventory tabs and control at ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1100 });
    const state = await setup(page);
    const pane = page.locator("#machine-details");
    await expect(
      pane.getByText("Debian GNU/Linux 13", { exact: true }),
    ).toBeVisible();
    await expect(pane.getByText("192.0.2.10", { exact: true })).toBeVisible();
    await expect(
      pane.getByRole("img", { name: "Screen preview of Clinic server" }),
    ).toBeVisible();
    await expect.poll(() => state.deleted.length).toBe(1);
    expect(state.calls[0].read_only).toBe(true);
    expect(
      state.input.some((m) => m.startsWith("3.key") || m.startsWith("5.mouse")),
    ).toBe(false);
    expect(await pane.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`proxmox-overview-${width}.png`),
      fullPage: true,
    });
    const download = page.waitForEvent("download");
    await pane
      .getByRole("button", { name: "Save screenshot", exact: true })
      .click();
    expect((await download).suggestedFilename()).toMatch(
      /^Clinic_server-.*\.png$/,
    );
    await pane.getByRole("tab", { name: "Network", exact: true }).click();
    await expect(pane.getByText("vmbr0", { exact: true })).toBeVisible();
    await pane.getByRole("tab", { name: "Performance", exact: true }).click();
    await expect(
      pane.getByRole("img", { name: "CPU over the last hour" }),
    ).toBeVisible();
    await pane.getByRole("tab", { name: "Snapshots", exact: true }).click();
    await expect(
      pane.getByText("before-update", { exact: true }),
    ).toBeVisible();
    await pane
      .getByRole("button", { name: "Screen control", exact: true })
      .click();
    const console = page.locator("dialog.infra-console");
    await expect(console.getByText("Connected", { exact: true })).toBeVisible();
    expect(state.calls.at(-1).read_only).toBeUndefined();
    await console
      .getByRole("button", { name: "Ctrl + Alt + Del", exact: true })
      .click();
    await expect
      .poll(() => state.input.some((m) => m.startsWith("3.key")))
      .toBe(true);
    await console.locator(".close").click();
    await expect.poll(() => state.deleted.length).toBeGreaterThanOrEqual(2);
  });
test("stopped VM and guest-agent errors remain useful without raw JSON", async ({
  page,
}) => {
  const state = await setup(page, { stopped: true });
  const pane = page.locator("#machine-details");
  await expect(
    pane.getByRole("button", { name: "Screen control" }),
  ).toBeDisabled();
  await expect(
    pane.getByText("Start the virtual machine to view its screen.").first(),
  ).toBeVisible();
  expect(state.calls).toHaveLength(0);
  await pane.getByRole("tab", { name: "Hardware", exact: true }).click();
  await expect(pane.getByText("UEFI", { exact: true })).toHaveCount(0);
  await expect(pane.getByText("64G", { exact: true })).toBeVisible();
  expect(await pane.locator("pre").count()).toBe(0);
});
test("busy console and missing guest agent show recovery instead of an empty panel", async ({
  page,
}) => {
  await setup(page, { busy: true, noGuest: true });
  const pane = page.locator("#machine-details");
  await expect(
    pane.getByText("Guest agent is not responding.", { exact: true }),
  ).toBeVisible();
  await expect(
    pane.getByText(
      "This provider console is already open; close it before reconnecting",
    ),
  ).toBeVisible();
  await expect(
    pane.getByRole("button", { name: "Refresh preview" }),
  ).toBeEnabled();
  await expect(
    pane.getByText("local-lvm:vm-101-disk-0", { exact: true }),
  ).toBeVisible();
});
test("late preview creation is closed after navigation and never attaches to another pane", async ({
  page,
}) => {
  const state = await setup(page, { late: true });
  await expect.poll(() => state.calls.length).toBe(1);
  await page.getByRole("button", { name: "Alerts", exact: false }).click();
  await expect.poll(() => state.deleted.length).toBe(1);
  await expect(page.locator(".pve-preview-screen img")).toHaveCount(0);
});
test("infrastructure opens the same organized VM overview", async ({
  page,
}) => {
  await setup(page);
  await page.locator("#machine-details .close").click();
  await page.goto("/#infrastructure");
  await page
    .getByRole("button", { name: "Clinic server", exact: true })
    .click();
  const pane = page.locator("dialog.infra-dialog");
  await expect(
    pane.getByText("Debian GNU/Linux 13", { exact: true }),
  ).toBeVisible();
  await expect(
    pane.getByRole("button", { name: "Screen control" }),
  ).toBeVisible();
  await expect(
    pane.getByRole("tab", { name: "Hardware", exact: true }),
  ).toBeVisible();
});
