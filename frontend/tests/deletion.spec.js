// Virtual records and deletion responses exist only in this browser context.
// All real business-data mutations are blocked by the route guard below.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
const accounts = JSON.parse(
  fs.readFileSync(path.resolve("../.local/demo-credentials.json"), "utf8"),
);
const fixtureId = 900000001;

async function setup(
  page,
  {
    resource = "drivers",
    role = "manager",
    blocked = false,
    conflict = false,
  } = {},
) {
  let deleted = false,
    requests = 0,
    previews = 0;
  const fixture =
    resource === "drivers"
      ? {
          id: fixtureId,
          version: 1,
          full_name: "Browser test driver",
          phone: "123",
          partner: null,
          partner_label: "",
          usual_vehicle: null,
          is_active: true,
          email: "",
          notes: "",
        }
      : {
          id: fixtureId,
          version: 1,
          reference: "ORD-900000001",
          status: "draft",
          dispatcher: 1,
          dispatcher_label: "Dispatcher",
          client: null,
          client_label: "",
          client_reference: "",
          price: null,
          date_received: "2026-10-29",
          notes: "",
          return_pending: false,
        };
  const root = `/api/${resource}/`;
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      method = request.method();
    const json = (body) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (url.pathname === `${root}${fixtureId}/delete-preview/`) {
      previews++;
      return json({
        allowed: !blocked,
        label: fixture.full_name || fixture.reference,
        version: previews,
        blockers: blocked
          ? [
              "This driver is linked to trips. Archive the profile to retain history.",
            ]
          : [],
        items: [
          { kind: resource === "drivers" ? "driver" : "order", count: 1 },
        ],
        confirmation_token: `reviewed-${previews}`,
      });
    }
    if (method === "DELETE" && url.pathname === `${root}${fixtureId}/`) {
      requests++;
      expect(request.postDataJSON()).toEqual({
        version: previews,
        confirmation_token: `reviewed-${previews}`,
      });
      if (conflict && requests === 1)
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            detail:
              "This record changed after your preview. Review the latest deletion details.",
          }),
        });
      deleted = true;
      return route.fulfill({ status: 204 });
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(method) &&
      !url.pathname.startsWith("/api/auth/")
    )
      return route.abort("blockedbyclient");
    if (url.pathname === root)
      return json({
        count: deleted ? 0 : 1,
        next: null,
        previous: null,
        results: deleted ? [] : [fixture],
      });
    if (url.pathname === `${root}${fixtureId}/`) return json(fixture);
    return route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Email address").fill(accounts[role].email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(accounts[role].password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Operations overview" }),
  ).toBeVisible();
  return { requests: () => requests };
}

test("manager can review, keep, then delete an unused driver from its list", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/#/drivers");
  const remove = page.getByRole("button", {
    name: "Delete Browser test driver",
    exact: true,
  });
  await remove.click();
  let dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Browser test driver", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Keep record", exact: true })
    .click();
  expect(state.requests()).toBe(0);
  await expect(remove).toBeVisible();
  await remove.click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Delete driver", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Driver deleted.");
  await expect(remove).toHaveCount(0);
  expect(state.requests()).toBe(1);
});

test("linked records explain why deletion is blocked without a confirm button", async ({
  page,
}) => {
  const state = await setup(page, { blocked: true });
  await page.goto("/#/drivers");
  await page
    .getByRole("button", { name: "Delete Browser test driver", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "This record must be kept" }),
  ).toBeVisible();
  await expect(dialog.getByText(/linked to trips/)).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Delete driver", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  expect(state.requests()).toBe(0);
});

test("a stale preview must be reviewed again before retrying deletion", async ({
  page,
}) => {
  const state = await setup(page, { conflict: true });
  await page.goto("/#/drivers");
  await page
    .getByRole("button", { name: "Delete Browser test driver", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Delete driver", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "changed after your preview",
  );
  await expect(
    dialog.getByRole("button", { name: "Delete driver", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Review latest details", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Delete driver", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(state.requests()).toBe(2);
});

test("dispatcher can delete a draft order and returns to the order list", async ({
  page,
}) => {
  const state = await setup(page, { role: "dispatcher", resource: "orders" });
  await page.goto(`/#/orders/${fixtureId}`);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete order", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/orders$/);
  await expect(page.locator(".toast")).toHaveText("Order deleted.");
  expect(state.requests()).toBe(1);
});

test("dispatcher does not see profile deletion controls", async ({ page }) => {
  await setup(page, { role: "dispatcher" });
  await page.goto("/#/drivers");
  await expect(
    page.getByRole("link", { name: "Browser test driver", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Delete Browser test driver",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "Browser test driver", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit profile", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete", exact: true }),
  ).toHaveCount(0);
});
