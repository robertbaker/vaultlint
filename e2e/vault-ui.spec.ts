import { expect, test } from "@playwright/test";

test.describe("vaultlint Web UI", () => {
  test("keeps the header sticky, hides it on downward scroll, and reveals it on upward scroll", async ({
    page,
  }) => {
    await page.goto("/");
    const header = page.locator(".app-header");

    await expect(header).toBeVisible();
    await expect(header).not.toHaveAttribute("inert", "");
    expect(await header.evaluate((element) => getComputedStyle(element).position)).toBe("sticky");

    await page.evaluate(() => window.scrollTo({ top: 600, behavior: "instant" }));
    await expect(header).toHaveClass(/app-header-hidden/);
    await expect(header).toHaveAttribute("inert", "");

    await page.evaluate(() => window.scrollTo({ top: 320, behavior: "instant" }));
    await expect(header).not.toHaveClass(/app-header-hidden/);
    await expect(header).not.toHaveAttribute("inert", "");
    await expect(header).toBeVisible();
  });

  test("shows touch-friendly item cards on narrow screens and keeps passwords masked", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "Try the sample vault" }).click();

    const itemList = page.getByRole("list", { name: "Vault items" });
    await expect(itemList.getByRole("listitem")).toHaveCount(4);
    await expect(
      itemList.getByRole("button", { name: "Show password for Google", exact: true }),
    ).toBeVisible();
    await expect(itemList.getByText("••••••••••••").first()).toBeVisible();
    await expect(page.getByRole("table")).toBeHidden();

    const navigation = page.getByRole("navigation", { name: "Vault workspace" });
    const navigationLayout = await navigation.evaluate((element) => {
      const buttons = [...element.querySelectorAll("button")];
      return {
        position: getComputedStyle(element).position,
        scrollsHorizontally: element.scrollWidth > element.clientWidth,
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        buttonCount: buttons.length,
        minButtonHeight: Math.min(...buttons.map((b) => b.getBoundingClientRect().height)),
      };
    });
    expect(navigationLayout.position).toBe("fixed");
    expect(navigationLayout.scrollsHorizontally).toBe(false);
    expect(navigationLayout.hasHorizontalOverflow).toBe(false);
    expect(navigationLayout.buttonCount).toBe(5);
    expect(navigationLayout.minButtonHeight).toBeGreaterThanOrEqual(44);

    const headerHeight = await page
      .locator(".app-header")
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(headerHeight).toBeLessThanOrEqual(844 * 0.12);
  });

  test("keeps local CLI imports collapsed until requested", async ({ page }) => {
    await page.goto("/");

    // Providers are listed asynchronously; wait for them instead of skipping on a race.
    const localCli = page.locator(".landing-cli-import");
    await expect(localCli).toBeVisible({ timeout: 10_000 });

    const countText = await localCli.locator(".landing-cli-count").textContent();
    const providerCount = Number.parseInt(countText ?? "", 10);
    expect(providerCount).toBeGreaterThan(0);
    await expect(localCli).not.toHaveAttribute("open", "");

    await localCli.locator("summary").click();
    await expect(localCli).toHaveAttribute("open", "");
    await expect(localCli.locator("button")).toHaveCount(providerCount);
  });

  test("keeps landing sections in a clear order", async ({ page }) => {
    await page.goto("/");
    await page.locator(".landing-dropzone").waitFor();

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => {
        const top = (selector: string) =>
          document.querySelector(selector)?.getBoundingClientRect().top ?? Number.NaN;
        return {
          hero: top(".landing-copy"),
          features: top(".feature-highlights"),
          workflow: top(".workflow-rail"),
          formats: top(".landing-format-rail"),
          dropzone: top(".landing-dropzone"),
          formatFlexWrap: (() => {
            const el = document.querySelector(".landing-format-rail");
            return el ? getComputedStyle(el).flexWrap : "";
          })(),
          hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        };
      });

      expect(layout.hero).toBeLessThan(layout.formats);
      expect(layout.formats).toBeLessThan(layout.features);
      expect(layout.features).toBeLessThan(layout.workflow);
      expect(layout.dropzone).toBeLessThan(layout.features);
      if (width === 390) expect(layout.formatFlexWrap).toBe("wrap");
      expect(layout.hasHorizontalOverflow).toBe(false);
    }
  });

  test("offers a mobile-friendly tour with direct workspace shortcuts", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "Quick tour" }).click();

    const tour = page.getByRole("dialog");
    await expect(tour.getByRole("heading", { name: "Bring in a vault export" })).toBeVisible();
    await tour.getByRole("button", { name: "Step 2: See what needs attention" }).click();
    await expect(tour.getByRole("heading", { name: "See what needs attention" })).toBeVisible();
    await tour.getByRole("button", { name: "Next step" }).click();
    await expect(tour.getByRole("heading", { name: "Make changes with control" })).toBeVisible();
    await tour.getByRole("button", { name: "Step 4: Save a clean copy" }).click();
    await tour.getByRole("button", { name: "Finish tour" }).click();
    await expect(tour).toBeHidden();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    await page.getByRole("button", { name: "Try the sample vault" }).click();
    // Loading parses through a lazily imported chunk, which can be slow when workers compete.
    // On mobile the toolbar and health summary start collapsed behind a toggle.
    const summaryToggle = page.getByRole("button", { name: /Vault summary/ });
    await expect(summaryToggle).toHaveAttribute("aria-expanded", "false", { timeout: 20_000 });
    await expect(page.getByRole("region", { name: "Vault health summary" })).toBeHidden();
    await summaryToggle.click();
    await expect(page.getByRole("region", { name: "Vault health summary" })).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("button", { name: "Quick tour", exact: true }).click();
    const workspaceTour = page.getByRole("dialog");
    await expect(
      workspaceTour.getByRole("heading", { name: "Bring in a vault export" }),
    ).toBeVisible();
    await workspaceTour.getByRole("button", { name: "Step 2: See what needs attention" }).click();
    await workspaceTour.getByRole("button", { name: "Open vault checks" }).click();
    await expect(workspaceTour).toBeHidden();
    await expect(page.getByRole("tab", { name: /Vault checks/ })).toBeVisible();

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("button", { name: "Quick tour", exact: true }).click();
    const exportTour = page.getByRole("dialog");
    await expect(
      exportTour.getByRole("heading", { name: "Bring in a vault export" }),
    ).toBeVisible();
    await exportTour.getByRole("button", { name: "Step 4: Save a clean copy" }).click();
    await exportTour.getByRole("button", { name: "Show export options" }).click();
    await expect(page.locator("[data-export-vault]")).toBeFocused();
  });

  test("keeps no recovery copy until the user opts in", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByLabel("Keep an encrypted local recovery copy");
    await expect(toggle).not.toBeChecked();
    await page.getByRole("button", { name: "Try the sample vault" }).click();
    await expect(page.getByText(/Changes saved encrypted on this browser/)).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("button", { name: "Resume session" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Try the sample vault" })).toBeVisible();
    const storedDrafts = await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const request = indexedDB.open("vaultlint-local-recovery", 1);
          request.onupgradeneeded = () => request.result.createObjectStore("drafts");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const count = request.result.transaction("drafts").objectStore("drafts").count();
            count.onsuccess = () => resolve(count.result);
            count.onerror = () => reject(count.error);
          };
        }),
    );
    expect(storedDrafts).toBe(0);
  });

  test("restores encrypted local work after a page reload when opted in", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Keep an encrypted local recovery copy").check();
    await expect(page.getByLabel("Keep an encrypted local recovery copy")).toBeChecked();
    await page.getByRole("button", { name: "Try the sample vault" }).click();
    await page.getByRole("button", { name: "Add Item" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill("Recovered Work");
    await dialog.getByLabel("Username", { exact: true }).fill("restore@example.com");
    await dialog.getByLabel("Password", { exact: true }).fill("Recovery-secret-2026!");
    await dialog.getByRole("button", { name: "Add Item" }).click();
    await expect(page.getByText(/Changes saved encrypted on this browser/)).toBeVisible();

    const localStorageContent = await page.evaluate(() => Object.values(localStorage).join("\n"));
    expect(localStorageContent).not.toContain("Recovery-secret-2026!");
    expect(localStorageContent).not.toContain("Recovered Work");

    await page.reload();
    await expect(page.getByLabel("Keep an encrypted local recovery copy")).toBeChecked();
    await page.getByRole("button", { name: "Resume session" }).click();
    await expect(page.getByRole("button", { name: /Total Items/ })).toContainText("5");
    await expect(page.locator("tbody")).toContainText("Recovered Work");
  });

  test("turning the recovery copy off deletes the saved copy", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByLabel("Keep an encrypted local recovery copy");
    await toggle.check();
    await page.getByRole("button", { name: "Try the sample vault" }).click();
    await expect(page.getByText(/Changes saved encrypted on this browser/)).toBeVisible();

    await toggle.uncheck();
    await expect(page.getByText(/Off: nothing is stored/)).toBeVisible();

    await page.reload();
    await expect(toggle).not.toBeChecked();
    await expect(page.getByRole("button", { name: "Resume session" })).toHaveCount(0);
  });

  test("confirms before replacing an open vault", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try the sample vault" }).click();
    await page.getByRole("button", { name: "Reload Sample" }).click();

    const confirmation = page.getByRole("alertdialog");
    await expect(
      confirmation.getByRole("heading", { name: "Load the sample vault?" }),
    ).toBeVisible();
    await expect(confirmation).toContainText("Export it first");
    await confirmation.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByLabel("Vault health summary").getByText("4").first()).toBeVisible();
  });

  test("loads sample vault, merges duplicates, fixes weak passwords, and supports undo/redo", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Lint your vault/ })).toBeVisible();

    // Load sample vault
    await page.getByRole("button", { name: "Try the sample vault" }).click();
    await expect(page.getByText("Local processing")).toBeVisible();

    // Verify summary stat chips
    const summary = page.getByLabel("Vault health summary");
    const workspaceNav = page.getByRole("navigation", { name: "Vault workspace" });
    await expect(summary).toBeVisible();
    await expect(summary.getByText("Total Items")).toBeVisible();
    await expect(summary.getByRole("button", { name: /Total Items/ })).toContainText("4");
    await expect(summary.getByRole("button", { name: /Duplicate Groups/ })).toContainText("1");
    await expect(summary.getByRole("button", { name: /Weak Passwords/ })).toContainText("2");
    await expect(summary.getByRole("button", { name: /FIDO2 Keys/ })).toContainText("1");

    await expect(summary.getByRole("button", { name: "Review duplicates" })).toBeVisible();
    await expect(summary.getByRole("button", { name: "Improve passwords" })).toBeVisible();
    await summary.getByRole("button", { name: "Review duplicates" }).click();
    await expect(page.getByRole("tabpanel")).toBeVisible();
    await workspaceNav.getByRole("button", { name: "Items" }).click();

    // Search & filter in Vault Explorer
    await page.getByLabel("Search vault items").fill("GitHub");
    await expect(page.getByText("1 matching item")).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody")).toContainText("dev@github.com");
    await page.getByLabel("Search vault items").fill("");
    await expect(page.locator("tbody tr")).toHaveCount(4);

    // Toggle password reveal
    await page.getByRole("button", { name: "Show password" }).first().click();
    await expect(page.locator("tbody")).toContainText("password");

    // Merge duplicates
    await workspaceNav.getByRole("button", { name: "Review" }).click();
    await page.getByRole("tab", { name: /Duplicates/ }).click();
    await page.getByRole("button", { name: "Merge All Duplicates" }).click();
    await expect(summary.getByRole("button", { name: /Total Items/ })).toContainText("3");
    await expect(summary.getByRole("button", { name: /Duplicate Groups/ })).toContainText("0");

    // Undo and Redo (the header hides while scrolling down, so return to the top first)
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(summary.getByRole("button", { name: /Total Items/ })).toContainText("4");
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.getByRole("button", { name: "Redo" }).click();
    await expect(summary.getByRole("button", { name: /Total Items/ })).toContainText("3");

    // Regenerate weak passwords
    await workspaceNav.getByRole("button", { name: "Review" }).click();
    await page.getByRole("tab", { name: /Security & links/ }).click();
    await page.getByRole("button", { name: "Regenerate All Weak" }).click();
    await expect(summary.getByRole("button", { name: /Weak Passwords/ })).toContainText("0");

    // Batch edit preview & apply
    await workspaceNav.getByRole("button", { name: "Organize" }).click();
    await page.getByLabel("Regex Pattern").fill("^GitHub$");
    await page.getByLabel("Replacement").fill("GitHub Enterprise");
    await page.getByRole("button", { name: "Preview Matches" }).click();
    await expect(page.getByText("GitHub Enterprise")).toBeVisible();
    await page.getByRole("button", { name: "Apply Batch Edit" }).click();

    await workspaceNav.getByRole("button", { name: "Items" }).click();
    await expect(page.locator("tbody")).toContainText("GitHub Enterprise");

    // Delete with confirmation dialog
    await page.getByRole("button", { name: "Delete" }).first().click();
    await expect(page.getByRole("heading", { name: "Delete Vault Item?" })).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(summary.getByRole("button", { name: /Total Items/ })).toContainText("2");

    // Add Item with live password strength meter
    await page.getByRole("button", { name: "Add Item" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill("Proton");
    await dialog.getByLabel("Username", { exact: true }).fill("user@proton.me");
    await dialog.getByLabel("Password", { exact: true }).fill("weak");
    await expect(dialog.getByText("Missing: 12+ chars, digit, special char")).toBeVisible();
    await dialog.getByRole("button", { name: "Generate" }).click();
    await expect(dialog.getByText("Strong", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Add Item" }).click();
    await expect(summary.getByRole("button", { name: /Total Items/ })).toContainText("3");

    // AI Assistant section
    await workspaceNav.getByRole("button", { name: "AI", exact: true }).click();
    const aiPanel = page.locator("app-ai-assistant-panel");
    await expect(aiPanel.getByText("AI Vault Assistant (Opt-In)")).toBeVisible();
    await expect(aiPanel.getByText(/Non-Local \(Cloud\) AI Disclaimer:/)).toBeVisible();
    await page.locator("#ai-tab-provider").selectOption("ollama");
    await expect(aiPanel.getByText(/Running locally at/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Organize Folders & Clean Names" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Find Possible Duplicates" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Suggest Missing URIs" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review vault patterns" })).toBeVisible();

    // Activity Log section
    await workspaceNav.getByRole("button", { name: "Activity", exact: true }).click();
    await expect(page.getByText("Session Activity Log")).toBeVisible();
    await expect(page.locator("app-activity-log-panel").getByText('Added "Proton".')).toBeVisible();

    // Compare export formats and select a target format
    await page.getByRole("button", { name: "Compare formats" }).click();
    const coveragePanel = page.locator("#export-coverage-panel");
    await expect(coveragePanel).toBeVisible();
    await expect(coveragePanel.getByText("Checking formats locally…")).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(coveragePanel.getByText(/Lossless|Changes/).first()).toBeVisible();
    await coveragePanel.getByRole("button", { name: "Use format" }).first().click();
    await expect(
      page.getByRole("region", { name: "Notifications" }).getByText(/Export format set to/),
    ).toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});
