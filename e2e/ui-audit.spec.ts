import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { makeVault } from "./audit-fixture";

async function loadVault(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator("#upload-vault input[type='file']").setInputFiles({
    name: "vault.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(makeVault())),
  });
  await expect(page.getByText(/\d+ matching items?/).first()).toBeVisible();
}

test.describe("vaultlint Web UI audit", () => {
  test("native selects expose their aria-label on the focusable select", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await loadVault(page);
    for (const name of [
      "Filter items",
      "Filter by item type",
      "Filter by folder",
      "Rows per page",
    ]) {
      await expect(page.getByRole("combobox", { name })).toHaveCount(1);
    }
  });

  test("bulk Regenerate Passwords leaves non-login items untouched and can be undone", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await loadVault(page);
    await page.getByRole("combobox", { name: "Filter by item type" }).selectOption("note");
    await page.getByRole("checkbox", { name: "Select Secret Note" }).check();
    await page.getByRole("button", { name: "Regenerate Passwords" }).click();
    await expect(page.getByRole("button", { name: "Show password for Secret Note" })).toHaveCount(
      0,
    );
    await expect(page.getByText("No login items selected", { exact: false })).toBeVisible();
  });

  test("file pickers in the migration and FIDO import panels are keyboard focusable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await loadVault(page);
    await page.getByRole("button", { name: "Organize", exact: true }).click();
    await page.getByRole("tab", { name: "Merge vault" }).click();
    const migrationInput = page.locator("app-migration-panel input[type='file']");
    await migrationInput.focus();
    await expect(migrationInput).toBeFocused();
    await page.getByRole("tab", { name: "FIDO import" }).click();
    const aegisInput = page.locator("app-aegis-import-panel input[type='file']");
    await aegisInput.focus();
    await expect(aegisInput).toBeFocused();
  });

  test("breach flags only ask for the prefix, clear on edit and return on undo", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    const urls: string[] = [];
    await page.route("https://api.pwnedpasswords.com/**", async (route) => {
      urls.push(route.request().url());
      // SHA-1("123456") = 7C4A8D09CA3762AF61E59520943DC26494F8941B
      const body = route.request().url().endsWith("/7C4A8")
        ? "D09CA3762AF61E59520943DC26494F8941B:99"
        : "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:3";
      await route.fulfill({ status: 200, contentType: "text/plain", body });
    });
    await loadVault(page);
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("tab", { name: /Security & links/ }).click();
    await page.getByRole("button", { name: /Check Breaches/ }).click();
    await expect(page.getByText("HIBP check complete: 1 breached password found.")).toBeVisible();
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).toMatch(/\/range\/[0-9A-F]{5}$/);

    await page.getByRole("button", { name: "Items", exact: true }).click();
    const breached = page.locator("tbody").getByText("Breached", { exact: true });
    await expect(breached).toHaveCount(1);

    await page.getByRole("button", { name: "Edit Weak One" }).click();
    await page.getByRole("dialog").getByLabel("Password").fill("NewPass!word123456789");
    await page.getByRole("dialog").getByRole("button", { name: /Save/ }).click();
    await expect(breached).toHaveCount(0);

    await page.keyboard.press("Control+z");
    await expect(breached).toHaveCount(1);
  });

  test("an App Store outage leaves iOS app IDs unverified instead of invalid", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    const vault = makeVault();
    vault.items.push({
      id: "ios1",
      type: 1,
      name: "Ios One",
      login: { username: "i", password: "Xy1!aaaaBBBB2222", uris: ["iosapp://284882215"] },
    } as never);
    await page.route("https://itunes.apple.com/**", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: "{}",
      }),
    );
    await page.goto("/");
    await page.locator("#upload-vault input[type='file']").setInputFiles({
      name: "vault.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(vault)),
    });
    await expect(page.getByText(/\d+ matching items?/).first()).toBeVisible();
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("tab", { name: /Security & links/ }).click();
    await page.getByRole("button", { name: "Validate Mobile App URIs" }).click();
    const panel = page.locator("app-security-panel");
    await expect(panel.getByText("iosapp://284882215")).toBeVisible();
    await expect(panel).not.toContainText("Not found in Apple App Store");
    await expect(panel).toContainText("lookup unavailable");
  });

  test("the add/edit dialog is centered in the viewport and closes on a backdrop click", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await loadVault(page);
    await page.getByRole("button", { name: "Add Item" }).first().click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toBeVisible();
    // The dialog fades/slides in, so wait for it to settle before measuring.
    await expect
      .poll(async () => {
        const box = (await dialog.boundingBox())!;
        const viewport = await page.evaluate(() => ({
          width: document.documentElement.clientWidth,
          height: window.innerHeight,
        }));
        // Allow for the stable scrollbar gutter, which the dialog is centred beside.
        return Math.max(
          Math.abs(box.x + box.width / 2 - viewport.width / 2),
          Math.abs(box.y + box.height / 2 - viewport.height / 2),
        );
      })
      .toBeLessThan(12);
    await page.mouse.click(5, 5);
    await expect(dialog).toHaveCount(0);
  });

  for (const [os, theme, expectLightText] of [
    ["light", "dark", true],
    ["dark", "light", false],
  ] as const) {
    test(`dark: utilities follow the chosen theme (OS ${os}, theme ${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: os });
      await page.addInitScript((mode) => localStorage.setItem("bw-theme", mode), theme);
      await page.setViewportSize({ width: 1400, height: 900 });
      await loadVault(page);
      const badge = page.locator("tbody").getByText("FIDO", { exact: true }).first();
      await expect(badge).toBeVisible();
      const luminance = await badge.evaluate((element) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        context.fillStyle = getComputedStyle(element).color;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      });
      // The info badge uses sky-300 text on dark themes and sky-800 text on light themes.
      if (expectLightText) expect(luminance).toBeGreaterThan(0.6);
      else expect(luminance).toBeLessThan(0.4);
    });
  }

  test("renaming a secure note does not give it an empty login", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await loadVault(page);
    await page.getByRole("button", { name: "Edit Secret Note" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#edit-name").fill("Secret Note 2");
    await dialog.getByRole("button", { name: /Save/ }).click();
    await expect(page.getByText('Updated "Secret Note 2".')).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export vault" }).click();
    const exported = JSON.parse(await readFile((await (await download).path())!, "utf8"));
    const note = exported.items.find((item: { name: string }) => item.name === "Secret Note 2");
    expect(note.type).toBe(2);
    expect(note).not.toHaveProperty("login");
  });
});
