import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** One page per layout/template the site uses. */
const PAGES = [
  "/",
  "/guides/getting-started/",
  "/guides/web-ui/",
  "/guides/troubleshooting/",
  "/cli/",
  "/cli/commands/",
  "/cli/formats/",
  "/security/local-first/",
  "/changelog/",
  "/404.html",
];

const VIEWPORTS = {
  desktop: { width: 1280, height: 860 },
  mobile: { width: 390, height: 844 },
} as const;

for (const theme of ["light", "dark"] as const) {
  for (const [device, viewport] of Object.entries(VIEWPORTS)) {
    test.describe(`site accessibility (${theme}, ${device})`, () => {
      test.use({ colorScheme: theme, reducedMotion: "reduce", viewport });

      for (const path of PAGES) {
        test(`${path} has no WCAG 2.2 AA violations`, async ({ page }) => {
          // Starlight stores the theme choice; force it so both palettes are checked.
          await page.addInitScript((t) => localStorage.setItem("starlight-theme", t), theme);
          await page.goto(path);
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

          const { violations } = await new AxeBuilder({ page })
            .withTags(WCAG_TAGS)
            // Starlight's own search button pairs aria-label="Search" with a visible "Ctrl K"
            // hint (label-content-name-mismatch). It is upstream markup, not ours.
            .exclude("button[data-open-modal]")
            .analyze();
          const summary = violations.map((v) => ({
            rule: v.id,
            nodes: v.nodes.slice(0, 5).map((n) => `${n.target.join(" ")} — ${n.failureSummary}`),
          }));
          expect(summary).toEqual([]);
        });
      }
    });
  }
}
