// Invoked only by core.test_quick_entry_browser, against its disposable DB.
const { chromium, expect: baseExpect } = require("@playwright/test");
const expect = baseExpect.configure({ timeout: 12000 });
const path = require("node:path");
const fs = require("node:fs");
if (!process.env.QUICK_TEST_API || !process.env.QUICK_TEST_EMAIL)
  throw new Error("A disposable Django test server is required.");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  let page;
  try {
    page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
      timezoneId: "Europe/Bucharest",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Every API request is fulfilled from the test server; none reach dev DB.
    await page.route("**/api/**", async (route) => {
      const original = new URL(route.request().url());
      const response = await route.fetch({
        url: process.env.QUICK_TEST_API + original.pathname + original.search,
      });
      await route.fulfill({ response });
    });
    await page.goto("http://127.0.0.1:5173");
    await page.getByLabel("Email address").fill(process.env.QUICK_TEST_EMAIL);
    await page
      .getByLabel("Password", { exact: true })
      .fill(process.env.QUICK_TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Operations overview" }),
    ).toBeVisible();
    const fill = async (price, distance) => {
      await page
        .getByRole("button", { name: "New order", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByLabel("Van registration", { exact: true })
        .selectOption(process.env.QUICK_TEST_VAN);
      await dialog
        .getByLabel("Ordering client (optional for draft)")
        .selectOption(process.env.QUICK_TEST_CLIENT);
      await dialog.getByLabel("Order price · EUR").fill(price);
      await dialog.getByLabel("Whole trip payable km").fill(distance);
      return dialog;
    };
    let dialog = await fill("650", "1280");
    await dialog
      .getByLabel("Starting position code", { exact: true })
      .fill("FR95");
    await dialog.getByLabel("Collection code", { exact: true }).fill("FR93");
    await dialog.getByLabel("Delivery code", { exact: true }).fill("SL42");
    await expect(
      dialog.locator(".quick-profit-preview > div:last-child strong"),
    ).toHaveText("€138.00");
    await expect(
      dialog.getByLabel("Goods description (optional)"),
    ).toBeHidden();
    const artifacts = path.resolve(".local");
    fs.mkdirSync(artifacts, { recursive: true });
    await page.screenshot({
      path: path.join(artifacts, "quick-entry-form.png"),
    });
    await dialog.locator(".quick-extra-details > summary").click();
    await dialog.getByLabel("Goods description (optional)").fill("Pallets");
    await dialog
      .getByRole("button", { name: "Save order", exact: true })
      .click();
    await expect(page).toHaveURL(/#\/orders\/\d+$/);
    const firstOrderUrl = page.url();
    await expect(page.locator(".dispatch-sheet")).toContainText("HD-86-GMC");
    await expect(page.locator(".dispatch-sheet")).toContainText(
      "FR95 → FR93 → SL42",
    );
    await expect(page.locator(".dispatch-sheet")).toContainText(
      "€138.00 est. profit",
    );
    await expect(page.locator(".shipment-details")).not.toHaveAttribute("open");
    await page.screenshot({
      path: path.join(artifacts, "quick-entry-summary.png"),
      fullPage: true,
    });
    // Existing orders edit the linked assignment directly and preserve its rate.
    await page
      .getByRole("button", { name: "Edit van / driver / start", exact: true })
      .click();
    let assignment = page.getByRole("dialog");
    await expect(
      assignment.getByLabel("Van registration", { exact: true }),
    ).toHaveValue(process.env.QUICK_TEST_VAN);
    await expect(
      assignment.getByLabel("Starting position code", { exact: true }),
    ).toHaveValue("FR95");
    await assignment
      .getByLabel("Van registration", { exact: true })
      .selectOption(process.env.QUICK_TEST_OTHER_VAN);
    await assignment
      .getByLabel("Assigned driver", { exact: true })
      .selectOption(process.env.QUICK_TEST_DRIVER);
    await expect(
      assignment
        .getByLabel("Assigned driver", { exact: true })
        .locator("option:checked"),
    ).toContainText("Romania");
    await assignment
      .getByLabel("Starting position code", { exact: true })
      .fill("FR80");
    await assignment
      .getByRole("button", { name: "Save dispatch details", exact: true })
      .click();
    await expect(page.locator(".dispatch-sheet")).toContainText("HD-99-EDIT");
    await expect(page.locator(".dispatch-sheet")).toContainText(
      "Assigned Driver",
    );
    await expect(page.locator(".dispatch-sheet")).toContainText(
      "FR80 → FR93 → SL42",
    );
    await expect(page.locator(".dispatch-sheet")).toContainText(
      "€138.00 est. profit",
    );
    await page
      .getByRole("button", { name: "Edit van / driver / start", exact: true })
      .click();
    assignment = page.getByRole("dialog");
    await expect(
      assignment.getByLabel("Assigned driver", { exact: true }),
    ).toHaveValue(process.env.QUICK_TEST_DRIVER);
    await assignment
      .getByLabel("Van registration", { exact: true })
      .selectOption(process.env.QUICK_TEST_VAN);
    await assignment
      .getByLabel("Starting position code", { exact: true })
      .fill("FR95");
    await assignment
      .getByRole("button", { name: "Save dispatch details", exact: true })
      .click();
    await expect(page.locator(".dispatch-sheet")).toContainText("HD-86-GMC");
    await page.getByRole("link", { name: "Orders", exact: true }).click();
    await expect(
      page.locator(".orders-table .dispatch-summary").first(),
    ).toContainText("FR95 → FR93 → SL42");
    dialog = await fill("250", "1300");
    // Select the first existing journey; selecting it loads its saved figures.
    const tripId = await dialog
      .getByLabel("Journey for this order")
      .locator("option")
      .nth(1)
      .getAttribute("value");
    await dialog.getByLabel("Journey for this order").selectOption(tripId);
    await dialog.getByLabel("Whole trip payable km").fill("1300");
    await dialog.getByLabel("Collection code", { exact: true }).fill("FR94");
    await dialog.getByLabel("Delivery code", { exact: true }).fill("SL43");
    await expect(dialog.getByLabel("Starting position code")).toHaveValue(
      "FR95",
    );
    await expect(
      dialog.locator(".quick-profit-preview > div:last-child strong"),
    ).toHaveText("€380.00");
    // A concurrent edit must not lose the newly typed route or total distance.
    await page.evaluate(async (id) => {
      const csrf = await (await fetch("/api/auth/csrf/")).json();
      const current = await (await fetch(`/api/trips/${id}/`)).json();
      const response = await fetch(`/api/trips/${id}/`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": csrf.csrfToken,
        },
        body: JSON.stringify({
          version: current.version,
          notes: "Concurrent test change",
        }),
      });
      if (!response.ok) throw new Error("Unable to exercise trip conflict");
    }, tripId);
    await dialog
      .getByRole("button", { name: "Save order", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await dialog
      .getByRole("button", { name: "Review latest trip figures", exact: true })
      .click();
    await expect(dialog.getByLabel("Whole trip payable km")).toHaveValue(
      "1300",
    );
    await expect(
      dialog.getByLabel("Collection code", { exact: true }),
    ).toHaveValue("FR94");
    await dialog
      .getByRole("button", { name: "Save order", exact: true })
      .click();
    await expect(page.locator(".dispatch-sheet")).toContainText(
      "€380.00 est. shared trip profit",
    );
    await page.getByRole("link", { name: "Orders", exact: true }).click();
    await expect(page.locator(".orders-table .dispatch-summary")).toHaveCount(
      2,
    );
    await page.screenshot({
      path: path.join(artifacts, "quick-entry-orders.png"),
      fullPage: true,
    });
    await page.locator(".orders-table .record-link").first().click();
    await page
      .getByRole("button", { name: "Edit van / driver / start", exact: true })
      .click();
    assignment = page.getByRole("dialog");
    await expect(
      assignment.getByText("Shared trip: 2 orders", { exact: true }),
    ).toBeVisible();
    await assignment
      .getByLabel("Starting position code", { exact: true })
      .fill("FR96");
    await page.screenshot({
      path: path.join(artifacts, "order-dispatch-edit.png"),
    });
    await assignment
      .getByRole("button", { name: "Save dispatch details", exact: true })
      .click();
    await expect(page.locator(".dispatch-sheet")).toContainText("FR96");
    await page.getByRole("link", { name: "Orders", exact: true }).click();
    await expect(
      page.locator(".orders-table .dispatch-summary-route"),
    ).toHaveCount(2);
    for (const row of await page
      .locator(".orders-table .dispatch-summary-route")
      .all())
      await expect(row).toContainText("FR96");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "New order", exact: true }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel("Starting position code", { exact: true })
      .fill("IT16");
    await dialog.getByLabel("Collection code", { exact: true }).fill("IT16");
    await dialog.getByLabel("Delivery code", { exact: true }).fill("HU10");
    await dialog
      .getByRole("button", { name: "Add collection", exact: true })
      .click();
    await dialog.getByLabel("Collection code 2", { exact: true }).fill("IT16");
    await expect(
      dialog.getByLabel("Country for point 1", { exact: true }),
    ).toHaveValue("Italy");
    await expect(
      dialog.getByLabel("Country for point 3", { exact: true }),
    ).toHaveValue("Hungary");
    await expect(
      dialog.locator(".quick-notebook-preview .route-preview"),
    ).toHaveText("IT16 → HU10");
    await expect(
      dialog.locator(
        '.quick-notebook-preview .country-flag[aria-label="Italy"]',
      ),
    ).toHaveCount(1);
    await expect(
      dialog.locator(
        '.quick-notebook-preview .country-flag[aria-label="Hungary"]',
      ),
    ).toHaveCount(1);
    await expect
      .poll(() =>
        dialog
          .locator(".quick-notebook-preview .country-flag img")
          .evaluateAll((images) =>
            images.every((img) => img.complete && img.naturalWidth > 0),
          ),
      )
      .toBe(true);
    const originCountry = dialog.getByLabel("Starting country", {
      exact: true,
    });
    for (const name of ["Scotland", "Northern Ireland", "Wales", "England"]) {
      await originCountry.fill(name);
      await originCountry.press("Enter");
      await expect(originCountry).toHaveValue(name);
      const flag = originCountry
        .locator("..")
        .getByRole("img", { name, exact: true })
        .locator("img");
      await expect(flag).toBeVisible();
      await expect
        .poll(() =>
          flag.evaluate((img) => img.complete && img.naturalWidth > 0),
        )
        .toBe(true);
    }
    await originCountry.fill("MA");
    await originCountry.press("Enter");
    await expect(originCountry).toHaveValue("Morocco");
    await originCountry.fill("Browser custom country");
    await dialog
      .getByRole("option")
      .filter({ hasText: "Add “Browser custom country”" })
      .click();
    await dialog
      .getByRole("button", { name: "Save country", exact: true })
      .click();
    await expect(originCountry).toHaveValue("Browser custom country");
    await expect(originCountry).toHaveAttribute("aria-expanded", "false");
    const collectionCountry = dialog.getByLabel("Country for point 1", {
      exact: true,
    });
    await collectionCountry.fill("Browser custom country");
    await collectionCountry.press("Enter");
    await expect(collectionCountry).toHaveValue("Browser custom country");
    await dialog
      .getByRole("button", { name: "Add customs", exact: true })
      .click();
    await expect(
      dialog.getByLabel("Point 3 type", { exact: true }),
    ).toHaveValue("customs");
    await dialog.getByLabel("Customs code", { exact: true }).fill("CH-BASEL");
    await dialog
      .getByRole("button", { name: "Move point 3 earlier", exact: true })
      .click();
    await expect(
      dialog.getByLabel("Point 2 type", { exact: true }),
    ).toHaveValue("customs");
    if (await dialog.evaluate((el) => el.scrollWidth > el.clientWidth))
      throw new Error("Quick form overflows on mobile");
    const bounds = await dialog
      .getByRole("button", { name: "Save order", exact: true })
      .boundingBox();
    const dialogBounds = await dialog.boundingBox();
    if (bounds.y + bounds.height > dialogBounds.y + dialogBounds.height + 1)
      throw new Error("Save action is clipped");
    await page.screenshot({
      path: path.join(artifacts, "quick-entry-mobile-form.png"),
    });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw new Error("Order list overflows on mobile");
    await page.screenshot({
      path: path.join(artifacts, "quick-entry-mobile-orders.png"),
      fullPage: true,
    });
    // Complete one shipment on the shared trip through the visible UI.
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(firstOrderUrl);
    await page
      .getByRole("button", { name: "Confirm booking", exact: true })
      .click();
    await expect(page.locator(".page-heading .pill")).toHaveText("Confirmed");
    await page
      .getByRole("button", { name: "Mark completed", exact: true })
      .click();
    const completion = page.getByRole("dialog");
    const completeButton = completion.getByRole("button", {
      name: "Complete shipment",
      exact: true,
    });
    await expect(completeButton).toBeDisabled();
    await completion
      .getByLabel("Completion note (optional)")
      .fill("Unloading confirmed by driver");
    await completion
      .getByLabel("I confirm all goods have been collected and delivered.")
      .check();
    await page.screenshot({
      path: path.join(artifacts, "shipment-completion.png"),
    });
    // A stop edit during review requires a fresh confirmation and keeps the note.
    await page.evaluate(async () => {
      const csrf = await (await fetch("/api/auth/csrf/")).json();
      const id = location.hash.split("/").pop();
      const response = await (await fetch(`/api/stops/?order=${id}`)).json();
      const stop = response.results[0];
      const changed = await fetch(`/api/stops/${stop.id}/`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": csrf.csrfToken,
        },
        body: JSON.stringify({
          version: stop.version,
          address: "Corrected unloading address",
        }),
      });
      if (!changed.ok)
        throw new Error(`Stop edit failed: ${await changed.text()}`);
    });
    await completeButton.click();
    await completion
      .getByRole("button", { name: "Review latest shipment", exact: true })
      .click();
    await expect(
      completion.getByLabel("Completion note (optional)"),
    ).toHaveValue("Unloading confirmed by driver");
    await expect(completeButton).toBeDisabled();
    await completion
      .getByLabel("I confirm all goods have been collected and delivered.")
      .check();
    await completeButton.click();
    await expect(completion).toBeHidden();
    await expect(page.locator(".page-heading .pill")).toHaveText("Delivered");
    await expect(
      page.getByRole("button", { name: "Mark completed", exact: true }),
    ).toBeHidden();
    await page.getByRole("link", { name: "Drivers", exact: true }).click();
    const driverRow = page.locator(
      `tr[data-record-id="${process.env.QUICK_TEST_DRIVER}"]`,
    );
    await expect(driverRow).toContainText("Romania");
    await driverRow
      .getByRole("link", { name: "Assigned Driver", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit profile", exact: true })
      .click();
    const driverForm = page.getByRole("dialog");
    await expect(
      driverForm.getByLabel("Citizenship", { exact: true }),
    ).toHaveValue("Romania");
    await driverForm.getByLabel("Citizenship", { exact: true }).fill("Hungary");
    await driverForm.getByLabel("Citizenship", { exact: true }).press("Enter");
    await driverForm
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(driverForm).toBeHidden();
    await expect(page.locator(".profile-details")).toContainText("Hungary");
    await page.screenshot({
      path: path.join(artifacts, "driver-citizenship.png"),
      fullPage: true,
    });
    await page.goto(firstOrderUrl);
    await expect(page.locator(".dispatch-driver")).toContainText(
      "Citizenship: Hungary",
    );
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      "Real browser → API → disposable database: quick order, existing assignment editing, shared trip, conflict recovery and mobile layouts passed.",
    );
  } catch (error) {
    await page
      ?.screenshot({
        path: path.resolve(".local/quick-entry-failure.png"),
        fullPage: true,
      })
      .catch(() => {});
    throw error;
  } finally {
    await page?.unrouteAll({ behavior: "ignoreErrors" });
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
