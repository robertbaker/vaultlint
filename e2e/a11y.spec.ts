import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoAxeViolations(page: Page, context: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    nodes: v.nodes.slice(0, 5).map((n) => `${n.target.join(" ")} — ${n.failureSummary ?? ""}`),
  }));
  expect(summary, `axe violations on ${context}`).toEqual([]);
}

const VIEWPORTS = {
  desktop: { width: 1280, height: 860 },
  mobile: { width: 390, height: 844 },
} as const;

for (const scheme of ["light", "dark"] as const) {
  for (const [device, viewport] of Object.entries(VIEWPORTS)) {
    test.describe(`accessibility (${scheme}, ${device})`, () => {
      // Reduced motion: axe must not sample toasts/dialogs mid-fade (false contrast failures).
      test.use({ colorScheme: scheme, reducedMotion: "reduce", viewport });

      test("landing page has no WCAG 2.2 AA violations", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoAxeViolations(page, `landing (${scheme}, ${device})`);
      });

      test("workspace tabs have no WCAG 2.2 AA violations", async ({ page }) => {
        // One axe pass per tab across every workspace section.
        test.setTimeout(90_000);
        await page.goto("/");
        await page.getByRole("button", { name: "Try the sample vault" }).click();
        await expect(page.locator("#vault-workspace")).toBeVisible();

        const sections = page
          .getByRole("navigation", { name: "Vault workspace" })
          .getByRole("button");
        const sectionCount = await sections.count();
        for (let s = 0; s < sectionCount; s++) {
          const sectionButton = sections.nth(s);
          const sectionLabel = (await sectionButton.innerText()).trim() || `section ${s}`;
          await sectionButton.focus();
          await page.keyboard.press("Enter");
          // Tabs re-render with the section; count them only once it is active.
          await expect(sectionButton).toHaveAttribute("aria-current", "page");
          const tabs = page.getByRole("tab");
          const tabCount = await tabs.count();
          if (tabCount === 0) {
            await expectNoAxeViolations(page, `workspace "${sectionLabel}" (${scheme}, ${device})`);
            continue;
          }
          for (let t = 0; t < tabCount; t++) {
            const tab = tabs.nth(t);
            const name = (await tab.innerText()).trim() || `tab ${t}`;
            // Drive tabs like a keyboard user: focus scrolls with scroll-padding, so this also
            // checks that focused tabs are not hidden under the sticky bars (WCAG 2.4.11).
            await tab.focus();
            await page.keyboard.press("Enter");
            await expect(tab).toHaveAttribute("aria-selected", "true");
            await expect(tab).toBeInViewport();
            await expectNoAxeViolations(page, `workspace "${name}" (${scheme}, ${device})`);
          }
        }
      });
    });
  }
}
