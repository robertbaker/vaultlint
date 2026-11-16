import { defineConfig, devices } from "@playwright/test";

/**
 * Accessibility checks for the built Astro docs site (`apps/site/dist`). Kept separate from the Web
 * UI suite so `bun run e2e` does not need a site build. Run with `bun run e2e:site`.
 */
export default defineConfig({
  testDir: "./e2e-site",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4329",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun run preview --port 4329 --host 127.0.0.1",
    cwd: "apps/site",
    url: "http://127.0.0.1:4329",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
