import { test, expect } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`create and revoke a site-scoped Chat integration at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    await page
      .context()
      .addCookies([
        { name: "speck-gallery", value: "1", url: "http://127.0.0.1:8761" },
      ]);
    let tokens = [];
    let created;
    const issued = "speck_ro_" + "a".repeat(43);
    await page.route("**/api/integrations/tokens**", async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        created = request.postDataJSON();
        const token = {
          id: "test-token",
          ...created,
          expires: Date.now() / 1000 + 86400,
          last_used: null,
          revoked: null,
        };
        tokens.push(token);
        return route.fulfill({ json: { ...token, token: issued } });
      }
      if (request.method() === "DELETE")
        tokens = tokens.map((t) => ({ ...t, revoked: Date.now() / 1000 }));
      await route.fulfill({
        json: { tokens, sites: ["Clinic A", "Clinic B"] },
      });
    });
    await page.goto("/#settings");
    await page
      .getByRole("button", { name: "Create integration token" })
      .click();
    await page
      .getByRole("combobox", { name: "Speck site", exact: true })
      .selectOption("Clinic B");
    await page
      .getByRole("combobox", { name: "Expires after", exact: true })
      .selectOption("90");
    await page
      .getByRole("button", { name: "Create token", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Copy your integration token" }),
    ).toBeVisible();
    expect(created).toEqual({
      name: "Slide Chat",
      site: "Clinic B",
      expires_days: 90,
      topology_connection_ids: [],
    });
    const secret = page.getByLabel("Read-only token", { exact: true });
    await expect(secret).toHaveValue(issued);
    await expect(secret).toHaveAttribute("type", "password");
    await expect(secret).toHaveAttribute("readonly", "");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.locator("#integration-issued")).toHaveCount(0);
    await page.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(page.locator("#integration-token-list")).toContainText(
      "Revoked",
    );
    await expect(
      page.getByRole("button", { name: "Revoke", exact: true }),
    ).toHaveCount(0);
  });
}

test("without named sites an all-sites token can still be created", async ({
  page,
}) => {
  await page
    .context()
    .addCookies([
      { name: "speck-gallery", value: "1", url: "http://127.0.0.1:8761" },
    ]);
  await page.route("**/api/integrations/tokens", (route) =>
    route.fulfill({ json: { tokens: [], sites: [], topology_connections: [] } }),
  );
  await page.goto("/#settings");
  await page.getByRole("button", { name: "Create integration token" }).click();
  await expect(
    page.getByRole("combobox", { name: "Speck site", exact: true }),
  ).toHaveValue("*");
});
