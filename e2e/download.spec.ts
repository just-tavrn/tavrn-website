// SPDX-License-Identifier: Apache-2.0
// The download page: the OS cards in a fixed order without JavaScript, the visitor's system first with it, the
// example-data state (disabled buttons, note), the verification details, the web and self-host cards, axe.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

const order = (page: import("@playwright/test").Page) =>
  page.locator("[data-os-cards] > [data-os-card]").evaluateAll((cards) => cards.map((c) => (c as HTMLElement).dataset.osCard));

test.describe("on Windows", () => {
  test.use({ userAgent: WINDOWS_UA });

  test("the Windows card comes first and is marked as recommended", async ({ page }) => {
    await page.goto("/download");
    await expect.poll(() => order(page)).toEqual(["windows", "linux", "macos", "mobile"]);
    const first = page.locator("[data-os-cards] > [data-os-card]").first();
    await expect(first.getByText("Recommended for your device")).toBeVisible();
    await expect(page.locator("[data-recommended-badge]:visible")).toHaveCount(1);
  });
});

test.describe("on Linux", () => {
  test.use({ userAgent: LINUX_UA });

  test("the Linux card moves to the front", async ({ page }) => {
    await page.goto("/download");
    await expect.poll(() => order(page)).toEqual(["linux", "windows", "macos", "mobile"]);
    await expect(page.locator('[data-os-card="linux"] [data-recommended-badge]')).toBeVisible();
  });
});

test.describe("on Android", () => {
  test.use({ userAgent: ANDROID_UA });

  test("the mobile card moves to the front", async ({ page }) => {
    await page.goto("/download");
    await expect.poll(() => order(page)).toEqual(["mobile", "windows", "linux", "macos"]);
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false, userAgent: WINDOWS_UA });

  test("every card is there in the fixed order, none recommended", async ({ page }) => {
    await page.goto("/download");
    expect(await order(page)).toEqual(["windows", "linux", "macos", "mobile"]);
    await expect(page.locator("[data-recommended-badge]:visible")).toHaveCount(0);
    for (const name of ["Windows", "Linux", "macOS", "Android and iOS", "Use it in the browser", "Self-host a node"]) {
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }
  });
});

test("before the first release: the note and disabled buttons, no download links", async ({ page }) => {
  await page.goto("/download");
  await expect(page.getByRole("note")).toContainText("No public release yet");
  const windows = page.locator('[data-os-card="windows"]');
  const installer = windows.getByRole("button", { name: /Installer \(\.exe\)/ });
  await expect(installer).toBeDisabled();
  await expect(installer).toContainText("9.8 MB");
  await expect(windows.getByRole("button", { name: /Windows Installer package \(\.msi\)/ })).toBeDisabled();
  const linux = page.locator('[data-os-card="linux"]');
  await expect(linux.getByRole("button", { name: /AppImage/ })).toBeDisabled();
  await expect(linux.getByRole("button", { name: /\.deb/ })).toBeDisabled();
  await expect(page.locator("a[download]")).toHaveCount(0);
  await expect(page.locator('[data-os-card="macos"]')).toContainText("Coming later");
  await expect(page.locator('[data-os-card="mobile"]')).toContainText("Coming later");
  // No release notes link to a release that is not public.
  await expect(page.getByRole("link", { name: /Release notes/ })).toHaveCount(0);
});

test("Linux lists the Electron AppImage and .deb, no .rpm", async ({ page }) => {
  await page.goto("/download");
  const linux = page.locator('[data-os-card="linux"]');
  await expect(linux.getByRole("button")).toHaveCount(2);
  await expect(linux.getByRole("button", { name: /AppImage/ })).toContainText("118 MB");
  await expect(linux.getByRole("button", { name: /\.deb/ })).toBeVisible();
  await expect(linux).not.toContainText(".rpm");
  await expect(linux).toContainText("Built with Electron.");
  await expect(linux).toContainText("adds the app to your menu");
});

test("Windows offers the Electron build only as a secondary disclosure", async ({ page }) => {
  await page.goto("/download");
  const windows = page.locator('[data-os-card="windows"]');
  // The Tauri installers are the buttons; the Electron build is not one of them.
  await expect(windows.locator(".dl-button")).toHaveCount(2);
  await expect(windows.locator(".dl-button", { hasText: /electron/i })).toHaveCount(0);
  const alt = windows.locator("details[data-alt-build]");
  await expect(alt).toHaveCount(1);
  await expect(alt).not.toHaveAttribute("open");
  const summary = alt.locator("summary");
  await expect(summary).toHaveText("Problems with the standard app? Alternative build (Electron)");
  expect(await summary.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeLessThan(15);
  await expect(alt.getByText("Electron build: Installer (.exe)")).toBeHidden();
  await summary.click();
  await expect(alt).toContainText("WebView2");
  await expect(alt.getByText("Electron build: Installer (.exe)")).toBeVisible();
  await expect(alt).toContainText("96.4 MB");
  // Example data: no link yet, and no button styling either way.
  await expect(alt.locator("a, button, .btn")).toHaveCount(0);
  // Only the Windows card has one.
  await expect(page.locator("details[data-alt-build]")).toHaveCount(1);
});

test("the verification details name the checksum command, the updater signature and the warnings", async ({ page }) => {
  await page.goto("/download");
  const windows = page.locator('[data-os-card="windows"]');
  await windows.getByText("Verify the download").click();
  await expect(windows.locator("pre")).toHaveText("Get-FileHash .\\Tavrn_0.2.0_x64-setup.exe -Algorithm SHA256");
  await expect(windows).toContainText("The checksum is listed here once the release is published.");
  await expect(windows).toContainText("signatures for the built-in updater");
  await expect(windows).toContainText("not code-signed yet");
  await expect(windows).toContainText("updates itself from latest.yml");
  const linux = page.locator('[data-os-card="linux"]');
  await linux.getByText("Verify the download").click();
  await expect(linux.locator("pre").first()).toHaveText("sha256sum Tavrn-0.2.0.AppImage");
  await expect(linux.locator("pre").last()).toHaveText("chmod +x Tavrn-0.2.0.AppImage");
  await expect(linux).toContainText("updates itself from latest-linux.yml");
  // The Electron packages carry no Tauri signature: no .sig note on Linux.
  await expect(linux).not.toContainText(".sig files");
});

test("the browser and self-host cards", async ({ page }) => {
  await page.goto("/download");
  const web = page.locator("[data-web-card]");
  await expect(web.getByRole("link", { name: "Open the web app" })).toHaveAttribute("href", "/app");
  await expect(web).toContainText("Every node serves the same web client");
  const host = page.locator("[data-selfhost-card]");
  await expect(host.locator("pre")).toHaveText("ghcr.io/just-tavrn/tavrn-node:0.2.0");
  await expect(host.getByRole("link", { name: "Read the install guide" })).toHaveAttribute("href", "/docs/admins/install/");
});

test("the download page has no serious axe findings with the details open", async ({ page }) => {
  await page.goto("/download");
  for (const summary of await page.locator("details.verify > summary").all()) await summary.click();
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} ${n.failureSummary ?? ""}`).slice(0, 3).join(" | ")}`);
  expect(serious).toEqual([]);
});
