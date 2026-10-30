import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

test.skip(
  fs.existsSync(path.resolve("../.local/real-data-mode")),
  "This database is used for real data. Run fixture-writing browser tests against a separate disposable database.",
);

const credentials = JSON.parse(
  fs.readFileSync(path.resolve("../.local/demo-credentials.json"), "utf8"),
);

async function signIn(page, role = "dispatcher") {
  await page.goto("/");
  await page.getByLabel("Email address").fill(credentials[role].email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(credentials[role].password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Operations overview" }),
  ).toBeVisible();
}

test("dashboard renders API-backed figures and manager account controls", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, "manager");
  await expect(page.getByText("Open orders", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Team accounts" })).toBeVisible();
  await page.screenshot({ path: "../.local/dashboard.png", fullPage: true });
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Clients", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Northline Logistics (demo)", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("dispatcher creates an order without documents, edits cargo, plans before assignment and returns goods after cancellation", async ({
  page,
}) => {
  const suffix = Date.now().toString().slice(-7);
  await signIn(page);
  await expect(page.getByRole("link", { name: "Team accounts" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "New order", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Ordering client")
    .selectOption({ label: "Northline Logistics (demo)" });
  await dialog.locator(".quick-extra-details > summary").click();
  await dialog.getByLabel("Client order reference").fill(`E2E-${suffix}`);
  await dialog.getByLabel("Order price · EUR").fill("550");
  await dialog.getByRole("button", { name: "Save order" }).click();
  await expect(page).toHaveURL(/#\/orders\/\d+/);
  const orderId = page.url().split("/").at(-1);
  await page.locator(".shipment-details > summary").click();
  for (const kind of ["collection", "delivery"]) {
    await page.getByRole("button", { name: "Add stop", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByRole("combobox", { name: "Task", exact: true })
      .selectOption(kind);
    await dialog
      .getByLabel("Site / location name")
      .fill(`E2E ${kind} ${suffix}`);
    await dialog.getByLabel("Location timezone").fill("Europe/Berlin");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByText(
        `${kind === "collection" ? "Collection" : "Delivery"} · E2E ${kind} ${suffix}`,
        { exact: true },
      ),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "Add cargo", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Collection stop")
    .selectOption({ label: `Collection: E2E collection ${suffix}` });
  await dialog
    .getByLabel("Delivery stop")
    .selectOption({ label: `Delivery: E2E delivery ${suffix}` });
  await dialog.getByLabel("Goods description").fill("E2E cargo");
  await dialog
    .getByRole("group", { name: "Client-reported details" })
    .getByLabel("Quantity")
    .fill("3");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/orders/${orderId}/`)).json())
          .status,
    )
    .toBe("confirmed");
  await page.getByRole("button", { name: "Edit cargo", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("group", { name: "Actual details at collection" })
    .getByLabel("Quantity")
    .fill("5");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toHaveCount(0);
  const cargo = (
    await (await page.request.get(`/api/cargo/?order=${orderId}`)).json()
  ).results[0];
  expect(cargo.reported.quantity).toBe("3");
  expect(cargo.actual.quantity).toBe("5");
  expect(
    (await (await page.request.get(`/api/reviews/?order=${orderId}`)).json())
      .count,
  ).toBe(0);

  await page.getByRole("link", { name: "Trip planning", exact: true }).click();
  await page.getByRole("button", { name: "New trip", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Trip name / region").fill(`E2E trip ${suffix}`);
  await dialog
    .getByLabel("Estimated payable km · includes empty travel")
    .fill("1300");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/#\/trips\/\d+/);
  const tripId = page.url().split("/").at(-1);
  let trip = await (await page.request.get(`/api/trips/${tripId}/`)).json();
  expect(trip.vehicle).toBeNull();
  expect(trip.status).toBe("planned");
  await page.getByRole("button", { name: "Assign order & plan stops" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Order to assign").selectOption(orderId);
  await dialog.getByRole("button", { name: "Record action" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".visit-card")).toHaveCount(2);
  await page.getByRole("button", { name: "Edit trip", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Transport partner", exact: true })
    .selectOption({ label: "Carpathia Couriers (demo)" });
  await dialog
    .getByRole("combobox", { name: "Van", exact: true })
    .selectOption({ label: "DEMO BOX 01" });
  await dialog
    .getByRole("combobox", { name: "Driver", exact: true })
    .selectOption({ label: "Andrei Pop (demo)" });
  await dialog
    .getByLabel("Final payable km · includes empty travel")
    .fill("1300");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Start trip", exact: true }).click();
  const collection = page.locator(".visit-card").filter({
    has: page.getByRole("heading", {
      name: `E2E collection ${suffix}`,
      exact: true,
    }),
  });
  await collection
    .getByRole("button", { name: "En route", exact: true })
    .click();
  await collection
    .getByRole("button", { name: "Arrived", exact: true })
    .click();
  await collection
    .getByRole("button", { name: "Complete task", exact: true })
    .click();
  await collection
    .getByRole("button", { name: "Record departure", exact: true })
    .click();
  await expect(collection.getByText("Departed", { exact: true })).toBeVisible();
  await page.goto(`/#/orders/${orderId}`);
  await page
    .getByRole("button", { name: "Cancel booking", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Client cancellation reason")
    .fill("E2E client paperwork incorrect");
  await dialog.getByRole("button", { name: "Record action" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/Return pending ·/)).toBeVisible();
  expect(
    (await (await page.request.get(`/api/reviews/?order=${orderId}`)).json())
      .count,
  ).toBe(0);
  await page.goto(`/#/trips/${tripId}`);
  await page
    .getByRole("button", { name: "Plan outstanding stops", exact: true })
    .click();
  const returns = page.locator(".visit-card").filter({
    has: page.getByRole("button", { name: "En route", exact: true }),
  });
  await returns.getByRole("button", { name: "En route", exact: true }).click();
  const arrivedReturn = page.locator(".visit-card").filter({
    has: page.getByRole("button", { name: "Arrived", exact: true }),
  });
  await arrivedReturn
    .getByRole("button", { name: "Arrived", exact: true })
    .click();
  const returnWork = page.locator(".visit-card").filter({
    has: page.getByRole("button", { name: "Complete task", exact: true }),
  });
  await returnWork
    .getByRole("button", { name: "Complete task", exact: true })
    .click();
  await page
    .locator(".visit-card")
    .filter({
      has: page.getByRole("button", { name: "Record departure", exact: true }),
    })
    .getByRole("button", { name: "Record departure", exact: true })
    .click();
  await expect(
    page
      .locator(".visit-card")
      .filter({
        has: page.getByText(`Return: E2E collection ${suffix}`, {
          exact: true,
        }),
      })
      .getByText("Departed", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Finish journey", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Record action" })
    .click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/trips/${tripId}/`)).json()).status,
    )
    .toBe("finished");
  const closed = await (
    await page.request.get(`/api/orders/${orderId}/`)
  ).json();
  expect(closed.status).toBe("cancelled");
  expect(closed.resolution).toBe("Returned to loading point");
  trip = await (await page.request.get(`/api/trips/${tripId}/`)).json();
  expect(trip.financials.cost).toBe("520.00");
  await page.screenshot({ path: "../.local/trip.png", fullPage: true });
});

test("documents preserve versions, link to several records and require login", async ({
  page,
  browser,
}) => {
  await signIn(page);
  const vans = (await (await page.request.get("/api/vehicles/")).json())
    .results;
  const van = vans.find((item) => item.registration === "DEMO BOX 01");
  await page.goto(`/#/vehicles/${van.id}`);
  await page
    .getByRole("button", { name: "Add document", exact: true })
    .first()
    .click();
  let dialog = page.getByRole("dialog");
  const title = `E2E insurance ${Date.now()}`;
  await dialog.getByLabel("Document title").fill(title);
  await dialog
    .getByRole("combobox", { name: "Document category", exact: true })
    .selectOption("insurance");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh1kAAAAASUVORK5CYII=",
    "base64",
  );
  await page.getByLabel("Document file").setInputFiles({
    name: "insurance-original.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page.getByRole("button", { name: "Upload file", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const card = page.locator(".document-card").filter({ hasText: title });
  await expect(
    card.getByRole("link", { name: /insurance-original.png/ }),
  ).toBeVisible();
  await card.getByRole("button", { name: "Add file / version" }).click();
  await page.getByLabel("Document file").setInputFiles({
    name: "insurance-renewed.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page.getByRole("button", { name: "Upload file", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    card.getByRole("link", { name: /insurance-renewed.png/ }),
  ).toBeVisible();
  const records = (
    await (
      await page.request.get(
        `/api/documents/?linked_resource=vehicles&linked_id=${van.id}`,
      )
    ).json()
  ).results;
  let document = records.find((item) => item.title === title);
  expect(document.files).toHaveLength(2);
  await page.goto(`/#/documents/${document.id}`);
  await page.getByRole("button", { name: "Link record", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Search records").fill("DEMO-BOOKING-1");
  await dialog
    .getByLabel("Linked record")
    .selectOption({ label: "ORD-000001" });
  await dialog
    .getByRole("button", { name: "Link document", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  document = await (
    await page.request.get(`/api/documents/${document.id}/`)
  ).json();
  expect(document.links.some((link) => link.resource === "vehicles")).toBe(
    true,
  );
  expect(document.links.some((link) => link.resource === "orders")).toBe(true);
  expect(document.files).toHaveLength(2);
  const download = await page.request.get(document.files[0].url);
  expect(download.status()).toBe(200);
  expect((await download.body()).equals(png)).toBe(true);
  const anonymous = await browser.newContext({
    baseURL: "http://127.0.0.1:5173",
  });
  expect((await anonymous.request.get(document.files[0].url)).status()).toBe(
    403,
  );
  await anonymous.close();
  await page.screenshot({ path: "../.local/documents.png", fullPage: true });
});

test("conflicting edits preserve typed values and require review of the latest record", async ({
  page,
  browser,
}) => {
  await signIn(page);
  await page.goto("/#/clients/1");
  await page.getByRole("button", { name: "Edit profile" }).click();
  const dialog = page.getByRole("dialog");
  const note = `E2E dispatcher revision ${Date.now()}`;
  await dialog.getByLabel("Internal notes").fill(note);
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:5173" });
  let token = (await (await other.request.get("/api/auth/csrf/")).json())
    .csrfToken;
  const login = await other.request.post("/api/auth/login/", {
    data: credentials.manager,
    headers: { "X-CSRFToken": token },
  });
  expect(login.status()).toBe(200);
  token = (await login.json()).csrfToken;
  const latest = await (await other.request.get("/api/clients/1/")).json();
  const update = await other.request.patch("/api/clients/1/", {
    data: { version: latest.version, notes: "E2E manager saved first" },
    headers: { "X-CSRFToken": token },
  });
  expect(update.status()).toBe(200);
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(
    dialog.getByRole("heading", { name: "Review the latest saved changes" }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Internal notes")).toHaveValue(note);
  await expect(dialog.getByText(/E2E manager saved first/)).toBeVisible();
  await dialog
    .getByRole("button", { name: "I reviewed this — reapply my edits" })
    .click();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await (await page.request.get("/api/clients/1/")).json()).notes).toBe(
    note,
  );
  await other.close();
});

test("mobile overview remains usable without horizontal page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Orders", exact: true }),
  ).toBeVisible();
  // The page itself stays fixed horizontally; wide tables remain independently scrollable.
  await page.locator(".mobile-nav-close").click();
  expect(
    await page.evaluate(
      () => document.body.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(150, 0));
  expect(await page.evaluate(() => window.scrollX)).toBe(0);
  // Orders use wrapping notebook cards on mobile, so horizontal table
  // scrolling is no longer required to read the primary shipment details.
  await page.screenshot({ path: "../.local/mobile.png", fullPage: true });
});
