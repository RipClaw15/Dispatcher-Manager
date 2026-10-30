// Browser/API/database flow, isolated from the working shipment database.
const { chromium, expect: baseExpect } = require("@playwright/test");
const expect = baseExpect.configure({ timeout: 12000 });
const path = require("node:path");
const fs = require("node:fs");
if (!process.env.POSTCODE_TEST_API)
  throw new Error("Disposable test server required.");

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
      await route.fulfill({
        response: await route.fetch({
          url: process.env.POSTCODE_TEST_API + url.pathname + url.search,
        }),
      });
    });
    await page.goto("http://127.0.0.1:5173");
    await page
      .getByLabel("Email address")
      .fill(process.env.POSTCODE_TEST_EMAIL);
    await page
      .getByLabel("Password", { exact: true })
      .fill(process.env.POSTCODE_TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Operations overview" }),
    ).toBeVisible();
    await page.goto(
      `http://127.0.0.1:5173/#/orders/${process.env.POSTCODE_TEST_ORDER}`,
    );
    await page.locator(".shipment-details > summary").click();
    await page
      .locator(".stop-card")
      .first()
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    let dialog = page.getByRole("dialog");
    let search = dialog.getByLabel("Find town or postcode", { exact: true });
    await search.fill("Budap");
    await dialog.getByRole("option").filter({ hasText: "1138" }).click();
    await expect(
      dialog.getByLabel("Town / region", { exact: true }),
    ).toHaveValue("Budapest");
    await expect(dialog.getByLabel("Postal code", { exact: true })).toHaveValue(
      "1138",
    );
    await expect(
      dialog.getByLabel("Short location code", { exact: true }),
    ).toHaveValue("HU11");
    await expect(dialog.getByLabel(/Street address/)).toHaveValue(
      "Dispatcher street",
    );
    await dialog
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(".stop-card").first()).toContainText("Budapest");
    await page.getByRole("link", { name: "Orders", exact: true }).click();
    await page.getByRole("button", { name: "New order", exact: true }).click();
    dialog = page.getByRole("dialog");
    const country = dialog.getByLabel("Country for point 1", { exact: true });
    await country.fill("Scotland");
    await country.press("Enter");
    search = dialog.getByLabel("Find town or postcode for point 1", {
      exact: true,
    });
    await search.fill("Edin");
    await dialog.getByRole("option").filter({ hasText: "Edinburgh" }).click();
    await expect(
      dialog.getByText(/GeoNames supplies postcode prefixes/),
    ).toBeVisible();
    const point = dialog.locator(".quick-route-point.route-collection").first();
    await point.locator(".point-location-details > summary").click();
    await expect(dialog.getByLabel("Town / region for point 1")).toHaveValue(
      "Edinburgh",
    );
    await expect(dialog.getByLabel("Full postal code for point 1")).toHaveValue(
      "EH1",
    );
    await country.fill("Hungary");
    await country.press("Enter");
    await search.fill("gyor");
    await expect(
      dialog.getByRole("option").filter({ hasText: "9021" }),
    ).toBeVisible();
    await search.press("Enter");
    await expect(dialog.getByLabel("Town / region for point 1")).toHaveValue(
      "Győr",
    );
    await country.fill("Morocco");
    await country.press("Enter");
    await search.fill("Rabat");
    await expect(
      point.getByText(/No postcode dataset is loaded/),
    ).toBeVisible();
    await dialog.getByLabel("Town / region for point 1").fill("Rabat");
    await dialog.getByLabel("Full postal code for point 1").fill("10431");
    await expect(
      dialog.getByRole("button", { name: "Save order", exact: true }),
    ).toBeEnabled();
    // Screenshot the real suggestions on mobile, without saving this extra order.
    await country.fill("Hungary");
    await country.press("Enter");
    await page.setViewportSize({ width: 390, height: 844 });
    await search.fill("Budap");
    await expect(
      dialog.getByRole("option").filter({ hasText: "1138" }),
    ).toBeVisible();
    expect(
      await dialog
        .getByRole("option")
        .filter({ hasText: "1138" })
        .evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return element.contains(
            document.elementFromPoint(
              bounds.x + bounds.width / 2,
              bounds.y + bounds.height / 2,
            ),
          );
        }),
    ).toBe(true);
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    fs.mkdirSync(path.resolve(".local"), { recursive: true });
    await page.screenshot({
      path: path.resolve(".local/postcode-search-mobile.png"),
      fullPage: true,
    });
    await search.press("Escape");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    if (errors.length) throw new Error(errors.join("\n"));
  } catch (error) {
    await page
      .screenshot({
        path: path.resolve(".local/postcodes-failure.png"),
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
