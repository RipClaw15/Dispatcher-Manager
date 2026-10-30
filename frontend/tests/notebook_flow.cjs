// All browser requests target Django's disposable database through this guard.
const { chromium, expect: baseExpect } = require("@playwright/test");
const expect = baseExpect.configure({ timeout: 12000 });
const path = require("node:path");
const fs = require("node:fs");
if (!process.env.NOTEBOOK_TEST_API)
  throw new Error("A disposable test server is required.");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({
        url: process.env.NOTEBOOK_TEST_API + url.pathname + url.search,
      });
      await route.fulfill({ response });
    });
    await page.goto("http://127.0.0.1:5173");
    await page
      .getByLabel("Email address")
      .fill(process.env.NOTEBOOK_TEST_EMAIL);
    await page
      .getByLabel("Password", { exact: true })
      .fill(process.env.NOTEBOOK_TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Operations overview" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Orders", exact: true }).click();
    if (process.env.NOTEBOOK_TEST_LATEST_MONTH) {
      await expect(page.getByLabel("Loading month")).toHaveValue("2024-06");
      await expect(page.locator(".notebook-results")).toContainText(
        "2 matching shipments",
      );
      const toggle = page.getByRole("button", { name: /^Filters/ });
      await toggle.click();
      await page
        .getByRole("button", { name: "Confirmed", exact: true })
        .click();
      await expect(page.locator(".notebook-results")).toContainText(
        "0 matching shipments",
      );
      await expect(page.getByLabel("Loading month")).toHaveValue("2024-06");
      await page
        .getByRole("button", { name: "All orders", exact: true })
        .click();
      await toggle.click();
      await page.getByRole("button", { name: "Today", exact: true }).click();
      await expect(page.getByLabel("Loading month")).toHaveValue("2026-10");
      await expect(
        page.locator('[data-loading-day="2026-10-30"]'),
      ).toBeVisible();
      await expect(page.locator(".notebook-results")).toContainText(
        "0 matching shipments",
      );
      await page
        .getByRole("button", { name: "Latest shipments", exact: true })
        .click();
      await expect(page.getByLabel("Loading month")).toHaveValue("2024-06");
      await expect(page.locator(".notebook-results")).toContainText(
        "2 matching shipments",
      );
      await page.reload();
      await expect(page.getByLabel("Loading month")).toHaveValue("2024-06");
      await expect(page.locator(".notebook-results")).toContainText(
        "2 matching shipments",
      );
      if (errors.length) throw new Error(errors.join("\n"));
      return;
    }
    const day = (date) => page.locator(`[data-loading-day="${date}"]`);
    const count = (number) =>
      expect(page.locator(".notebook-results")).toContainText(
        `${number} matching shipment`,
      );
    await count(5);
    await expect(page.getByLabel("Loading month")).toHaveValue("2026-10");
    await expect(page.locator(".notebook-day:visible").first()).toHaveAttribute(
      "data-loading-day",
      "2026-10-30",
    );
    await expect(day("2026-10-29")).toBeVisible();
    await expect(day("2026-10-01")).toBeVisible();
    await expect(day("2026-09-30")).toHaveCount(0);
    await expect(day("2026-10-31")).toBeHidden();
    await page.locator(".notebook-upcoming > summary").click();
    await expect(day("2026-10-31")).toBeVisible();
    await page.locator(".notebook-upcoming > summary").click();
    const filterToggle = page.getByRole("button", { name: /^Filters/ });
    await expect(filterToggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Filter by van")).toBeHidden();
    await filterToggle.click();
    await page
      .getByLabel("Filter by van")
      .selectOption(process.env.NOTEBOOK_TEST_VAN);
    await count(3);
    await filterToggle.click();
    await expect(page.getByLabel("Filter by van")).toBeHidden();
    await expect(filterToggle).toHaveText("Filters (1)");
    await count(3);
    await filterToggle.click();
    await expect(page.getByLabel("Filter by van")).toHaveValue(
      process.env.NOTEBOOK_TEST_VAN,
    );
    await page
      .getByLabel("Filter by client")
      .selectOption(process.env.NOTEBOOK_TEST_CLIENT);
    const loadingCountry = page.getByLabel("Filter by loading country");
    await loadingCountry.fill("Italy");
    await loadingCountry.press("Enter");
    const deliveryCountry = page.getByLabel("Filter by delivery country");
    await deliveryCountry.fill("Hungary");
    await deliveryCountry.press("Enter");
    await page.getByRole("button", { name: "Confirmed", exact: true }).click();
    await count(1);
    await expect(
      page.locator(`tr[data-record-id="${process.env.NOTEBOOK_TEST_TODAY}"]`),
    ).toBeVisible();
    await page
      .getByLabel("Filter by client")
      .selectOption(process.env.NOTEBOOK_TEST_OTHER_CLIENT);
    await count(0);
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await count(5);
    await page.getByLabel("Filter by van").selectOption("unassigned");
    await count(1);
    await expect(day("2026-10-01")).toBeVisible();
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Previous month", exact: true })
      .click();
    await expect(page.getByLabel("Loading month")).toHaveValue("2026-09");
    await count(102);
    // The visible month is complete even beyond DRF's 100-record page size.
    await expect(page.locator(".orders-table .record-link")).toHaveCount(102);
    await expect(page.locator(".notebook-day").first()).toHaveAttribute(
      "data-loading-day",
      "2026-09-30",
    );
    await page.locator(".orders-table .record-link").first().click();
    await expect(page.locator(".dispatch-sheet")).toBeVisible();
    await page.getByRole("link", { name: "All orders", exact: true }).click();
    await expect(page.getByLabel("Loading month")).toHaveValue("2026-09");
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await count(5);
    await filterToggle.click();
    await page.getByRole("button", { name: /^No loading date/ }).click();
    await count(2);
    await expect(page.getByLabel("Loading month")).toBeDisabled();
    const undatedRow = page.locator(
      `tr[data-record-id="${process.env.NOTEBOOK_TEST_UNDATED}"]`,
    );
    await undatedRow.getByRole("button", { name: /^Set loading date/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Loading date", { exact: true }).fill("2026-10-29");
    // A concurrent stop edit must preserve the typed date and request review.
    await page.evaluate(async (id) => {
      const csrf = await (await fetch("/api/auth/csrf/")).json();
      const preview = await (
        await fetch(`/api/orders/${id}/loading-date/`)
      ).json();
      const response = await fetch(`/api/stops/${preview.stop.id}/`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": csrf.csrfToken,
        },
        body: JSON.stringify({
          version: preview.stop.version,
          address: "Updated loading address",
        }),
      });
      if (!response.ok) throw new Error("Concurrent stop edit failed");
    }, process.env.NOTEBOOK_TEST_UNDATED);
    await dialog
      .getByRole("button", { name: "Save loading date", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Review latest loading stop", exact: true })
      .click();
    await expect(
      dialog.getByLabel("Loading date", { exact: true }),
    ).toHaveValue("2026-10-29");
    await dialog
      .getByRole("button", { name: "Save loading date", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await count(1);
    await expect(undatedRow).toHaveCount(0);
    await page
      .locator(`tr[data-record-id="${process.env.NOTEBOOK_TEST_NO_STOP}"]`)
      .getByRole("button", { name: /^Set loading date/ })
      .click();
    await expect(dialog.getByText(/Add a collection stop/)).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Save loading date", exact: true }),
    ).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: /^Daily notebook/ }).click();
    await count(6);
    await expect(
      day("2026-10-29").locator(
        `tr[data-record-id="${process.env.NOTEBOOK_TEST_UNDATED}"]`,
      ),
    ).toBeVisible();
    fs.mkdirSync(path.resolve(".local"), { recursive: true });
    await filterToggle.click();
    await page.screenshot({
      path: path.resolve(".local/orders-notebook-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: path.resolve(".local/orders-notebook-mobile.png"),
      fullPage: true,
    });
    await filterToggle.click();
    await expect(page.getByLabel("Filter by van")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: path.resolve(".local/orders-notebook-mobile-filters.png"),
      fullPage: true,
    });
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      "Notebook month boundaries, 102-record pagination, filters, undated records, date conflict recovery and mobile layout passed.",
    );
  } catch (error) {
    await page
      .screenshot({
        path: path.resolve(".local/orders-notebook-failure.png"),
        fullPage: true,
      })
      .catch(() => {});
    throw error;
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
