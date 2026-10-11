import { test, expect } from "./fixtures.mjs";

async function signedIn(page, transform = (d) => d, role = "admin") {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { username: "demo", csrf: "preview-only", role } }),
  );
  await page.route(/\/api\/fleet(?:\?.*)?$/, async (route) => {
    const data = await (await route.fetch()).json();
    await route.fulfill({
      json: { ...data, machines: data.machines.map(transform) },
    });
  });
  await page.goto("/#fleet");
  await expect(page.locator('[data-device="frontdesk"]').first()).toBeVisible();
}
async function machine(page, tab = "overview") {
  await page.locator('[data-device="frontdesk"]').first().click();
  await expect(page.locator(".machine-health")).toBeVisible();
  if (tab !== "overview") await page.locator(`[data-tab="${tab}"]`).click();
}

for (const width of [1440, 834, 390, 320]) {
  test(`Fleet and machine identity remain readable at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 960 });
    await signedIn(page);
    const copy = page.locator('[data-row="restored-frontdesk"] .machine-name');
    await expect(copy).toContainText("BYD-FRONTDESK · restored");
    if (width <= 760) {
      expect(
        await copy
          .locator("b")
          .evaluate((el) => getComputedStyle(el).whiteSpace),
      ).toBe("normal");
      expect(
        await copy
          .locator("b")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBeTruthy();
    }
    await page.screenshot({
      path: info.outputPath(`fleet-${width}.png`),
      fullPage: true,
    });
    await machine(page);
    if (width <= 600) {
      const title = await page.locator(".machine-title").boundingBox();
      const links = await page
        .locator(".device-drawer .resource-navigation")
        .boundingBox();
      expect(links.y).toBeGreaterThanOrEqual(title.y + title.height);
      expect(title.height).toBeLessThan(32);
    }
    await page.screenshot({
      path: info.outputPath(`machine-${width}.png`),
      fullPage: true,
    });
    await page.locator('[data-tab="network"]').click();
    await expect(page.locator("[data-interface]").first()).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`network-${width}.png`),
      fullPage: true,
    });
    expect(
      await page
        .locator(".device-drawer")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBeTruthy();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}

for (const shape of ["windows", "linux", "normalized"]) {
  test(`${shape} endpoint network reports preserve interface routes and counters`, async ({
    page,
  }) => {
    const route =
      shape === "windows"
        ? {
            DestinationPrefix: "203.0.113.0/24",
            NextHop: "192.0.2.1",
            InterfaceAlias: "Ethernet",
            RouteMetric: 0,
          }
        : shape === "linux"
          ? {
              dst: "203.0.113.0/24",
              gateway: "192.0.2.1",
              dev: "Ethernet",
              metric: 0,
            }
          : {
              destination: "203.0.113.0/24",
              gateway: "192.0.2.1",
              interface: "Ethernet",
              metric: 0,
            };
    const counter =
      shape === "normalized"
        ? {
            name: "Ethernet",
            bytes_recv: 2048,
            bytes_sent: 0,
            packets_recv: 5,
            packets_sent: 0,
          }
        : {
            name: "Ethernet",
            bytesRecv: 2048,
            bytesSent: 0,
            packetsRecv: 5,
            packetsSent: 0,
          };
    await signedIn(page, (d) => ({
      ...d,
      telemetry: {
        ...d.telemetry,
        network: {
          ...d.telemetry.network,
          routes: [route],
          counters: [counter],
          connections: [
            {
              pid: 42,
              process: "Example worker",
              local: { ip: "2001:db8::24", port: 4444 },
              remote: { ip: "2001:db8::20", port: 443 },
              status: "ESTABLISHED",
            },
          ],
        },
      },
    }));
    await machine(page, "network");
    const routes = page
      .getByRole("heading", { name: "Routes", exact: true })
      .locator("..");
    await expect(routes).toContainText("203.0.113.0/24");
    await expect(routes).toContainText("Ethernet");
    await expect(page.locator("#device-body")).toContainText(
      "[2001:db8::24]:4444 → [2001:db8::20]:443",
    );
    await page.locator("[data-interface]").first().click();
    const pane = page.getByRole("dialog", { name: "Ethernet", exact: true });
    await expect(pane).toContainText("2 KB");
    await expect(pane).toContainText("0 B");
    await expect(pane).toContainText("203.0.113.0/24");
    await expect(pane).not.toContainText("Open its receipt");
  });
}

test("network empty states refer to endpoint evidence without inventing collection receipts", async ({
  page,
}) => {
  await signedIn(page, (d) => ({
    ...d,
    telemetry: { ...d.telemetry, network: {} },
  }));
  await machine(page, "network");
  await expect(page.locator("#device-body")).toContainText(
    "No routes were included in the last agent report.",
  );
  await expect(page.locator("#device-body")).toContainText(
    "No DNS resolvers were included in the last agent report.",
  );
  await expect(page.locator("#device-body")).toContainText(
    "No network connections were included in the last agent report.",
  );
  await expect(page.locator("#device-body")).not.toContainText(
    "Open its receipt",
  );
});

test("inspection reports show loading, actionable failure and recovered inventory", async ({
  page,
}, info) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let failed = true;
  await page.route("**/api/devices/frontdesk/inspections", async (route) => {
    await gate;
    return failed
      ? route.fulfill({
          status: 503,
          json: { detail: "Inspection storage unavailable" },
        })
      : route.fulfill({
          json: [
            {
              kind: "processes",
              job_id: "inspect-1",
              collected: Date.now() / 1000,
              report: {
                rows: [{ pid: 42, name: "Example worker", memory_bytes: 2048 }],
                scope: "Windows test report",
                limit: 250,
              },
            },
          ],
        });
  });
  await signedIn(page);
  await machine(page, "inventory");
  await expect(
    page.locator("[data-inspection-report] .loading-state"),
  ).toBeVisible();
  await expect(page.locator("[data-inspection-kind]")).toBeDisabled();
  release();
  await expect(
    page.locator('[data-inspection-report] [role="alert"]'),
  ).toContainText("Unable to load inspection reports");
  await page.screenshot({
    path: info.outputPath("inventory-error.png"),
    fullPage: true,
  });
  failed = false;
  await page.locator("[data-inspection-retry]").click();
  await expect(page.locator("[data-inspection-report]")).toContainText(
    "Example worker",
  );
  await expect(page.locator("[data-inspection-kind]")).toBeEnabled();
});

for (const lifecycle of ["offline", "unapproved", "revoked"]) {
  test(`${lifecycle} machines keep reports but disable all inspection collection actions`, async ({
    page,
  }) => {
    await page.route("**/api/devices/frontdesk/inspections", (route) =>
      route.fulfill({ json: [] }),
    );
    await signedIn(page, (d) => ({
      ...d,
      online: lifecycle !== "offline",
      approved: lifecycle !== "unapproved",
      revoked: lifecycle === "revoked",
    }));
    await machine(page, "inventory");
    await expect(page.locator("[data-inspection-collect]")).toBeDisabled();
    await expect(page.locator("[data-inspection-bundle]")).toBeDisabled();
    await expect(page.locator("[data-inspection-kind]")).toBeEnabled();
    await expect(page.locator("#device-body")).toContainText(
      lifecycle === "unapproved" ? "approve this machine" : lifecycle,
    );
  });
}

test("failed inspection preparation restores its button and reports the error", async ({
  page,
}) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/devices/frontdesk/inspections", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(
    "**/api/devices/frontdesk/inspection/preview",
    async (route) => {
      await gate;
      await route.fulfill({
        status: 503,
        json: { detail: "Inspection preview unavailable" },
      });
    },
  );
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signedIn(page);
  await machine(page, "inventory");
  const button = page.locator("[data-inspection-collect]");
  await button.click();
  await expect(button).toHaveText("Preparing review…");
  await expect(button).toHaveAttribute("aria-busy", "true");
  release();
  await expect(page.getByRole("alert")).toContainText(
    "Inspection preview unavailable",
  );
  await expect(button).toHaveText("Review collection");
  await expect(button).toBeEnabled();
  expect(errors).toEqual([]);
});

test("viewer service deep links remain read-only", async ({ page }) => {
  await signedIn(page, (d) => d, "viewer");
  const ref = encodeURIComponent(
    JSON.stringify({
      kind: "service",
      id: "SpeckAgent",
      connection: "frontdesk",
    }),
  );
  await page.goto("/#fleet?inspect=" + ref);
  const pane = page.getByRole("dialog", { name: "Speck Agent", exact: true });
  await expect(pane).toBeVisible();
  await expect(pane).toContainText("Your viewer role");
  await expect(
    pane.locator("[data-service-action], [data-service-inspect]"),
  ).toHaveCount(0);
});

test("leaving an inspection while its review is prepared discards a late response", async ({
  page,
}) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/devices/frontdesk/inspections", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(
    "**/api/devices/frontdesk/inspection/preview",
    async (route) => {
      await gate;
      await route.fulfill({
        json: { note: "Synthetic inspection", script: "Example script" },
      });
    },
  );
  await signedIn(page);
  await machine(page, "inventory");
  const button = await page
    .locator("[data-inspection-collect]")
    .elementHandle();
  await page.locator("[data-inspection-collect]").click();
  await expect(page.locator("[data-inspection-collect]")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await page.locator(".device-drawer > .dialog-head .close").click();
  await expect(page.locator(".device-drawer")).toHaveCount(0);
  release();
  await expect
    .poll(() => button.evaluate((el) => el.hasAttribute("aria-busy")))
    .toBeFalsy();
  await expect(page.locator("[data-collect-confirm]")).toHaveCount(0);
});

test("Active app sorting follows the app name shown in each row, including process fallbacks", async ({
  page,
}) => {
  await signedIn(page, (d) => ({
    ...d,
    telemetry: {
      ...d.telemetry,
      active_app:
        d.id === "frontdesk"
          ? { title: "  ", process: "ZZZ-Worker.exe" }
          : { title: "Example editor", process: "AAA-Editor.exe" },
    },
  }));
  await page.locator("#fleet-view").click();
  await page.getByLabel("Sort machines").selectOption("app");
  await expect(page.locator("#fleet-rows tr").last()).toHaveAttribute(
    "data-row",
    "frontdesk",
  );
  await expect(page.locator('[data-row="frontdesk"] .app-cell')).toHaveText(
    "ZZZ-Worker.exe",
  );
});

test("refresh after reviewed collection keeps the selected inventory category", async ({
  page,
}) => {
  await page.route("**/api/devices/frontdesk/inspections", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/devices/frontdesk/inspection/preview", (route) =>
    route.fulfill({
      json: {
        note: "Read-only software inventory",
        script: "Example read-only inspection script",
      },
    }),
  );
  await page.route("**/api/devices/frontdesk/inspection", (route) =>
    route.fulfill({ json: { id: "inspect-polish" } }),
  );
  await page.route("**/api/jobs/inspect-polish", (route) =>
    route.fulfill({
      json: {
        id: "inspect-polish",
        status: "complete",
        result: { output: "Collected software inventory" },
      },
    }),
  );
  await signedIn(page);
  await machine(page, "inventory");
  await expect(page.locator("[data-inspection-kind]")).toBeEnabled();
  await page.locator("[data-inspection-kind]").selectOption("software");
  await page.locator("[data-inspection-collect]").click();
  await page.locator("[data-collect-confirm]").click();
  await page.locator("[data-inspection-open]").click();
  await expect(page.locator("[data-inspection-kind]")).toHaveValue("software");
});
