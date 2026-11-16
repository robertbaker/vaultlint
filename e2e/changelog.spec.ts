import { expect, test, type Page } from "@playwright/test";

const CHANGELOG_URL = "https://raw.githubusercontent.com/robertbaker/vaultlint/main/CHANGELOG.md";

const SAMPLE_CHANGELOG = `# Changelog

## [1.1.0](https://github.com/robertbaker/vaultlint/compare/v1.0.0...v1.1.0) (2026-11-16)

### Features

* **web:** add changelog modal ([abc1234](https://github.com/robertbaker/vaultlint/commit/abc1234567890))

### Bug Fixes

* **cli:** handle empty vault ([def5678](https://github.com/robertbaker/vaultlint/commit/def5678901234))

## [1.0.0](https://github.com/robertbaker/vaultlint/compare/v0.9.0...v1.0.0) (2026-11-10)

### Features

* initial release ([1112223](https://github.com/robertbaker/vaultlint/commit/1112223334445))
`;

async function serveChangelog(page: Page, body = SAMPLE_CHANGELOG) {
  await page.route(CHANGELOG_URL, (route) =>
    route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body }),
  );
}

test.describe("Web changelog", () => {
  test("header shows version and opens changelog modal from GitHub", async ({ page }) => {
    await serveChangelog(page);
    await page.goto("/");

    const trigger = page.locator("[data-open-changelog]");
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dialog = page.locator("#changelog-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "What's new" })).toBeVisible();
    await expect(dialog.getByText("add changelog modal")).toBeVisible();
    await expect(dialog.getByText("handle empty vault")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Open the changelog on GitHub" })).toBeVisible();

    await dialog.getByLabel("Search the changelog").fill("empty");
    await expect(dialog.getByText("handle empty vault")).toBeVisible();
    await expect(dialog.getByText("add changelog modal")).toBeHidden();

    await dialog.getByRole("button", { name: "Close changelog" }).click();
    await expect(dialog).toBeHidden();
  });

  test("shows error state when GitHub fetch fails without cache", async ({ page }) => {
    await page.route(CHANGELOG_URL, (route) =>
      route.fulfill({ status: 503, body: "Service Unavailable" }),
    );
    await page.goto("/");
    await page.locator("[data-open-changelog]").click();

    await expect(page.locator("#changelog-error")).toContainText("Could not load the changelog");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("rejects non-https links in changelog markdown", async ({ page }) => {
    await serveChangelog(
      page,
      `## [1.0.0](javascript:alert) (2026-11-16)\n\n### Features\n\n* safe text ([abc1234](http://insecure.example/c))\n`,
    );
    await page.goto("/");
    await page.locator("[data-open-changelog]").click();

    const dialog = page.locator("#changelog-dialog");
    await expect(dialog.getByText("safe text")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Compare changes on GitHub" })).toHaveCount(0);
    await expect(dialog.getByRole("link", { name: /Commit abc1234/ })).toHaveCount(0);
  });
});
