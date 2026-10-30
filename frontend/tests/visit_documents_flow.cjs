// Real UI and API, exclusively against Django's disposable database and uploads.
const { chromium, expect: baseExpect } = require("@playwright/test");
const expect = baseExpect.configure({ timeout: 12000 });
const path = require("node:path");
const fs = require("node:fs");
if (!process.env.VISIT_TEST_API || !process.env.VISIT_TEST_EMAIL)
  throw new Error("A disposable Django test server is required.");

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
        url: process.env.VISIT_TEST_API + url.pathname + url.search,
      });
      await route.fulfill({ response });
    });
    await page.goto("http://127.0.0.1:5173");
    await page.getByLabel("Email address").fill(process.env.VISIT_TEST_EMAIL);
    await page
      .getByLabel("Password", { exact: true })
      .fill(process.env.VISIT_TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Operations overview" }),
    ).toBeVisible();
    await page.goto(
      `http://127.0.0.1:5173/#/trips/${process.env.VISIT_TEST_TRIP}`,
    );
    await expect(page.locator(".visit-card")).toHaveCount(4);
    const allDocuments = page
      .locator("section.panel")
      .filter({
        has: page.getByRole("heading", {
          name: "All trip documents",
          exact: true,
        }),
      });
    await expect(
      allDocuments.getByText("Agreed order", { exact: true }),
    ).toBeVisible();
    await expect(
      allDocuments.getByText("Trip paperwork", { exact: true }),
    ).toBeVisible();
    // These references prove mutations retain the page and mounted route cards.
    await page.evaluate(() => {
      window.visitTestDocument = document;
      window.visitTestCard = document.querySelector(".visit-card");
    });
    const preserved = async () => {
      expect(
        await page.evaluate(
          () =>
            window.visitTestDocument === document &&
            window.visitTestCard === document.querySelector(".visit-card"),
        ),
      ).toBe(true);
    };
    const visit = (id) => page.locator(`[data-visit-id="${id}"]`);
    const loading = visit(process.env.VISIT_TEST_LOADING);
    const customs = visit(process.env.VISIT_TEST_CUSTOMS);
    const unloading = visit(process.env.VISIT_TEST_UNLOADING);
    const handover = visit(process.env.VISIT_TEST_HANDOVER);
    await expect(
      page.getByRole("button", { name: "Add document", exact: true }),
    ).toHaveCount(5);
    await page.getByRole("button", { name: "Start trip", exact: true }).click();
    await expect(page.locator(".page-heading .pill")).toHaveText("In progress");
    await preserved();
    const progress = async (card, task = false) => {
      await card.getByRole("button", { name: "En route", exact: true }).click();
      await expect(card).toHaveClass(/visit-en_route/);
      await expect(
        card.getByRole("button", { name: "Arrived", exact: true }),
      ).toBeVisible();
      await preserved();
      await card.getByRole("button", { name: "Arrived", exact: true }).click();
      await expect(card).toHaveClass(/visit-arrived/);
      await expect(card.locator(".visit-content > small")).toContainText(
        "Arrived",
      );
      if (task) {
        await card
          .getByRole("button", { name: "Complete task", exact: true })
          .click();
        await expect(card.locator(".visit-task .pill")).toHaveText("Completed");
        await expect(
          card.getByRole("button", { name: "Complete task", exact: true }),
        ).toBeHidden();
      }
      await card
        .getByRole("button", { name: "Record departure", exact: true })
        .click();
      await expect(card).toHaveClass(/visit-departed/);
      await expect(card.locator(".visit-content > small")).toContainText(
        "Departed",
      );
      await preserved();
    };
    // A visit can be completed before receiving its documents.
    await progress(loading, true);
    const attach = async (card, title, kind, name, mimeType, buffer) => {
      await card
        .getByRole("button", { name: "Add document", exact: true })
        .click();
      let dialog = page.getByRole("dialog");
      await expect(dialog.getByLabel("Document category")).toHaveValue(kind);
      await dialog.getByLabel("Document title").fill(title);
      await dialog
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      dialog = page.getByRole("dialog");
      await dialog
        .getByLabel("Document file")
        .setInputFiles({ name, mimeType, buffer });
      await dialog
        .getByRole("button", { name: "Upload file", exact: true })
        .click();
      await expect(dialog).toBeHidden();
      await expect(
        card.getByRole("link", { name: new RegExp(name) }),
      ).toBeVisible();
      await expect(allDocuments.getByText(title, { exact: true })).toHaveCount(
        1,
      );
      await preserved();
    };
    await attach(
      loading,
      "Signed loading CMR",
      "loading_cmr",
      "loading-cmr.pdf",
      "application/pdf",
      Buffer.from("%PDF-1.4 visit fixture"),
    );
    await attach(
      customs,
      "Customs paperwork",
      "customs",
      "customs.png",
      "image/png",
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7ioAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    await progress(customs);
    await attach(
      unloading,
      "Unloading goods documents",
      "unloading_cmr",
      "goods.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      Buffer.from("Disposable Word fixture"),
    );
    await progress(unloading, true);
    // No files at the handover visit: uploads never gate operational progress.
    await progress(handover);
    const downloadPromise = page.waitForEvent("download");
    await allDocuments.getByRole("link", { name: /loading-cmr.pdf/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("loading-cmr.pdf");
    expect(fs.readFileSync(await download.path(), "utf8")).toBe(
      "%PDF-1.4 visit fixture",
    );
    await expect(allDocuments.locator(".document-card")).toHaveCount(5);
    fs.mkdirSync(path.resolve(".local"), { recursive: true });
    await page.screenshot({
      path: path.resolve(".local/visit-documents-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await loading.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: path.resolve(".local/visit-documents-mobile.png"),
      fullPage: true,
    });
    await page.goto(
      `http://127.0.0.1:5173/#/orders/${process.env.VISIT_TEST_ORDER}`,
    );
    await expect(page.locator(".page-heading .pill")).toHaveText("Delivered");
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      "Visit uploads, combined documents, private download and status changes without reload passed.",
    );
  } catch (error) {
    await page
      .screenshot({
        path: path.resolve(".local/visit-documents-failure.png"),
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
