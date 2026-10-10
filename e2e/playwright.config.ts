// SPDX-License-Identifier: Apache-2.0
// End-to-end tests of the built site: `astro preview` serves dist/ on port 4400 (build first: `pnpm build`).
// Run only Chromium and the Android phone emulation, with two workers:
//   pnpm exec playwright test -c e2e/playwright.config.ts --project chromium --project mobile-android --workers=2
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 4400);
const ci = !!process.env.CI;

export default defineConfig({
  testDir: ".",
  outputDir: "../test-results",
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: 2,
  reporter: ci ? [["list"], ["html", { open: "never", outputFolder: "../playwright-report" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-android", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // --ignore-lock keeps the server in the foreground (Astro moves it to the background when an agent runs it).
    command: `pnpm exec astro preview --port ${port} --host 127.0.0.1 --ignore-lock`,
    cwd: "..",
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: !ci,
    timeout: 60_000,
  },
});
