// SPDX-License-Identifier: Apache-2.0
//
// Playwright configuration of the screenshot script (make.ts). It expects a running development node and web
// client (README.md; run.sh starts both) and starts nothing itself.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /make\.ts$/,
  workers: 1,
  reporter: "list",
  // Traces of failed runs go to the temporary directory, never into the tavrn-web checkout.
  outputDir: process.env.SHOTS_RESULTS ?? join(tmpdir(), "tavrn-shots-results"),
  // One long "test": setup plus some forty captures.
  timeout: 1_500_000,
  expect: { timeout: 15_000 },
  projects: [{ name: "chromium" }],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${process.env.SHOTS_WEB_PORT ?? "5700"}`,
    locale: "en-US",
    colorScheme: "dark",
    trace: "retain-on-failure",
    actionTimeout: 20_000,
  },
});
