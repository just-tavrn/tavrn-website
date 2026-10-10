// SPDX-License-Identifier: Apache-2.0
//
// Renders the Open Graph preview image (public/og.png, 1200×630) from scripts/og/template.html with the brand
// background src/assets/brand/og-background.png, the wordmark and the self-hosted Inter font, through the
// Chromium that Playwright installs for the end-to-end tests. Run it with `just og-image` after changing the
// template or the background; the result is committed.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "og.png");
const file = (p) => pathToFileURL(resolve(root, p)).href;

const html = readFileSync(join(root, "scripts", "og", "template.html"), "utf8")
  .replace("__BG__", file("src/assets/brand/og-background.png"))
  .replace("__LOGO__", file("src/assets/brand/logo-320.png"))
  .replace("__INTER__", file("node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"));

const dir = mkdtempSync(join(tmpdir(), "tavrn-og-"));
const page = join(dir, "og.html");
writeFileSync(page, html);
const browser = await chromium.launch();
try {
  const tab = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await tab.goto(pathToFileURL(page).href);
  await tab.evaluate(() => document.fonts.ready);
  await tab.screenshot({ path: out, type: "png", omitBackground: false });
  console.log(`og-image: wrote ${out}`);
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
