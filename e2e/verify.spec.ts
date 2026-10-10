// SPDX-License-Identifier: Apache-2.0
// The checksum verifier of the download page: a file checked on the device against a pasted value and against the
// checksums of the release the page shows, which arrive at runtime as GitHub's asset digests (mocked:
// e2e/fixtures/gh-releases.ts). In the release fixtures with `fixtureDigests`, e2e/fixtures/example-installer.bin is
// the Tauri installer and example-appimage.bin the AppImage (both by SHA-256).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { scenarios } from "./fixtures/gh-releases";
import { mockReleases } from "./mocks";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const installer = join(fixtures, "example-installer.bin");
const appImage = join(fixtures, "example-appimage.bin");
const sha = (algo: string, path: string, enc: "hex" | "base64" = "hex") => createHash(algo).update(readFileSync(path)).digest(enc);
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

const fileInput = (page: Page) => page.getByLabel("Choose file");
const expected = (page: Page) => page.getByLabel("Expected checksum (optional)");
const result = (page: Page) => page.locator("[data-result]");

// Today's state by default: the beta v0.3.0-rc.1, whose installer and AppImage are the fixtures.
test.beforeEach(async ({ page }) => {
  await mockReleases(page);
});

/** Opens the download page and waits until the release (and with it the known checksums) is there. */
async function open(page: Page, path = "/download") {
  await page.goto(path);
  await expect(page.locator("[data-releases]")).not.toHaveAttribute("data-state", "loading");
}

/** A file that is not one of the release's: the fixture's bytes with a suffix. */
function otherFile() {
  const buffer = Buffer.concat([readFileSync(installer), Buffer.from("changed\n")]);
  return { name: "something-else.exe", mimeType: "application/octet-stream", buffer, hex: createHash("sha256").update(buffer).digest("hex") };
}

test("a file that matches the checksum you pasted", async ({ page }) => {
  await open(page);
  const file = otherFile();
  await expected(page).fill(`  ${file.hex.slice(0, 20)}\n${file.hex.slice(20).toUpperCase()} `);
  await fileInput(page).setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
  await expect(result(page)).toContainText("Matches the checksum you pasted (SHA-256).");
  await expect(result(page)).toContainText(`something-else.exe, ${file.buffer.length} B`);
  await expect(result(page)).toHaveAttribute("aria-live", "polite");
});

test("a file that matches nothing shows its computed SHA-256 with a copy button", async ({ page }) => {
  await open(page);
  const file = otherFile();
  await fileInput(page).setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
  await expect(result(page)).toContainText("No match: the computed SHA-256 is");
  await expect(result(page).locator("code")).toHaveText(file.hex);
  await expect(result(page).getByRole("button", { name: "Copy" })).toBeVisible();
  // A wrong pasted value says so, with the computed value of the pasted algorithm.
  await expected(page).fill(sha("sha256", installer));
  await expect(result(page)).toContainText("Does not match the checksum you pasted (SHA-256).");
  await expect(result(page)).toContainText("It matches none of the checksums listed for this release.");
  await expect(result(page).locator("code")).toHaveText(file.hex);
});

test("the release's own checksums: GitHub's SHA-256 digests of the installer and the AppImage", async ({ page }) => {
  await open(page);
  await fileInput(page).setInputFiles(installer);
  await expect(result(page)).toContainText("Matches Tavrn_0.3.0-rc.1_x64-setup.exe (SHA-256).");
  await fileInput(page).setInputFiles(appImage);
  await expect(result(page)).toContainText("Matches Tavrn-0.3.0-rc.1.AppImage (SHA-256).");
  // electron-updater's base64 SHA-512 (latest-linux.yml) pasted by hand matches as well.
  await expected(page).fill(sha("sha512", appImage, "base64"));
  await expect(result(page)).toContainText("Matches the checksum you pasted (SHA-512).");
  // Something that is not a checksum is not compared.
  await expected(page).fill("not a checksum");
  await expect(result(page)).toContainText("is not a SHA-256 or SHA-512 checksum");
});

test("the known checksums follow the selected channel", async ({ page }) => {
  await mockReleases(page, { web: { body: scenarios.both() } });
  await open(page);
  // The fixtures are the stable release's installer and AppImage, not the beta's.
  await fileInput(page).setInputFiles(installer);
  await expect(result(page)).toContainText("Matches Tavrn_0.3.0_x64-setup.exe (SHA-256).");
  await page.getByRole("tab", { name: /^Beta/ }).click();
  // The result shown is checked again against the beta's checksums.
  await expect(result(page)).toContainText("No match: the computed SHA-256 is");
  await fileInput(page).setInputFiles(appImage);
  await expect(result(page)).toContainText("No match");
  await page.getByRole("tab", { name: /^Stable/ }).click();
  await expect(result(page)).toContainText("Matches Tavrn-0.3.0.AppImage (SHA-256).");
});

test("with the beta tab from #beta, the beta's checksums are the known ones", async ({ page }) => {
  await mockReleases(page, { web: { body: scenarios.both() } });
  await open(page, "/download#beta");
  await fileInput(page).setInputFiles(installer);
  await expect(result(page)).toContainText("No match");
});

test("without a release the verifier still compares with a pasted checksum", async ({ page }) => {
  await mockReleases(page, { web: { status: 404 } });
  await open(page);
  await expected(page).fill(sha("sha256", installer));
  await fileInput(page).setInputFiles(installer);
  await expect(result(page)).toContainText("Matches the checksum you pasted (SHA-256).");
  await expect(result(page)).not.toContainText("Matches Tavrn");
});

test("the verifier says the file stays on the device, and nothing is sent", async ({ page }) => {
  const requests: string[] = [];
  await open(page);
  // The page's own loading (scripts, the Status link's check) is done before the file is chosen.
  await page.waitForLoadState("networkidle");
  page.on("request", (r) => requests.push(r.url()));
  await expect(page.getByText("The file is checked on your device and never uploaded.")).toBeVisible();
  await fileInput(page).setInputFiles(installer);
  await expect(result(page)).toContainText("Matches");
  expect(requests).toEqual([]);
});

test("each card's verify details link to the verifier", async ({ page }) => {
  await open(page);
  const windows = page.locator('[data-os-card="windows"]');
  await windows.getByText("Verify the download").click();
  await windows.getByRole("link", { name: "Check a file you downloaded on this page" }).click();
  await expect(page).toHaveURL(/#verify$/);
  await expect(page.getByRole("heading", { name: "Check a downloaded file" })).toBeInViewport();
});

test("the file input is labelled and reachable with the keyboard", async ({ page }) => {
  await open(page);
  await expect(fileInput(page)).toHaveAttribute("type", "file");
  await expect(fileInput(page)).toHaveAccessibleName("Choose file");
  await expect(expected(page)).toHaveAccessibleDescription(/Paste a SHA-256 or SHA-512/);
  // From the heading area onwards, Tab reaches the file input and then the text field.
  await page.locator("#verify-title").evaluate((h) => {
    h.setAttribute("tabindex", "-1");
    (h as HTMLElement).focus();
  });
  await page.keyboard.press("Tab");
  await expect(fileInput(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(expected(page)).toBeFocused();
});

test("without JavaScript the verifier explains the alternative", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/download");
  await expect(page.locator("[data-verifier-nojs]")).toBeVisible();
  await expect(page.locator("[data-verifier-ui]")).toBeHidden();
  await context.close();
});

test("the download page with a result has no serious axe findings", async ({ page }) => {
  await open(page);
  await fileInput(page).setInputFiles({ name: "x.bin", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
  await expect(result(page)).toContainText("No match");
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} ${n.failureSummary ?? ""}`).slice(0, 3).join(" | ")}`);
  expect(serious).toEqual([]);
});
