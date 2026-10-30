// Safe against the working database: these checks read business data and open
// forms, but never submit a business-record mutation.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const credentials = JSON.parse(
  fs.readFileSync(path.resolve("../.local/demo-credentials.json"), "utf8"),
).manager;

async function signIn(page) {
  await page.goto("/");
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Operations overview" }),
  ).toBeVisible();
}

test("live deletion preview can be inspected and closed without deleting records", async ({
  page,
}) => {
  await page.route("**/api/**", (route) => {
    const request = route.request();
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method()) &&
      !new URL(request.url()).pathname.startsWith("/api/auth/")
    )
      return route.abort("blockedbyclient");
    return route.continue();
  });
  await signIn(page);
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await expect(page.locator(".loading")).toHaveCount(0);
  const remove = page
    .locator(".table-row-actions button[aria-label^='Delete ']")
    .first();
  test.skip(
    (await remove.count()) === 0,
    "No existing clients to preview; no fixtures are created in the working database.",
  );
  const response = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/delete-preview/"),
  );
  await remove.click();
  const previewResponse = await response;
  expect(previewResponse.status()).toBe(200);
  const preview = await previewResponse.json();
  expect(typeof preview.allowed).toBe("boolean");
  await expect(
    page.getByRole("dialog").getByText(preview.label, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(remove).toBeVisible();
});

test("desktop navigation and order filters use the live API", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  await expect(
    page.getByRole("button", { name: "Open navigation", exact: true }),
  ).toBeHidden();
  await expect(page.locator(".nav-label")).toHaveText([
    "Operations",
    "Directory",
    "Management",
  ]);
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(
    page.getByRole("table", { name: "Orders", exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Filters/ }).click();
  const response = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/orders/notebook/" &&
      url.searchParams.get("status") === "draft"
    );
  });
  await page.getByRole("button", { name: "Draft", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(
    page.getByRole("button", { name: "Draft", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "All orders", exact: true }).click();
  expect(errors).toEqual([]);
});

test("entry forms are sectioned and keep company assignment optional", async ({
  page,
}) => {
  await signIn(page);
  for (const [resource, singular, section, field] of [
    [
      "orders",
      "order",
      "Booking details",
      "Ordering client (optional for draft)",
    ],
    ["vehicles", "van", "Vehicle details", "Transport partner (optional)"],
    ["drivers", "driver", "Driver details", "Transport partner (optional)"],
  ]) {
    await page.goto(`/#/${resource}`);
    await page
      .getByRole("button", { name: `New ${singular}`, exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: section, exact: true }),
    ).toBeVisible();
    const company = dialog.getByLabel(field);
    expect(await company.evaluate((element) => element.required)).toBe(false);
    await expect(company).toHaveValue("");
    await expect(
      dialog.getByRole("button", {
        name: resource === "orders" ? "Save order" : "Save changes",
        exact: true,
      }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Close dialog" }).click();
  }
});

test("mobile navigation opens, closes and reaches orders without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const toggle = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("link", { name: "Orders", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Orders", exact: true }),
  ).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".notebook-results")).toBeVisible();
  await expect(page.locator(".panel .loading")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "New order", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Close dialog" }).click();
});
