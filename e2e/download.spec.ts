// SPDX-License-Identifier: Apache-2.0
// The download page, rendered at runtime from the site's GitHub proxies (/gh/releases/web, /gh/releases/node,
// /gh/repos/web), which are mocked here (e2e/mocks.ts, e2e/fixtures/gh-releases.ts): the visitor's system first,
// stable only, beta only (today's state), stable and a newer beta as tabs, an older beta, nothing usable, the proxy's
// 404, server and network errors, a private repository, the verification details, the node image, the loading state
// without a jump, the page without JavaScript, axe in each state (axe needs JavaScript, so not without it), and no
// request to another origin.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { nodeRelease, repository, scenarios } from "./fixtures/gh-releases";
import { mockReleases, mockRuntime, NODE } from "./mocks";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const DL = "https://github.com/just-tavrn/tavrn-web/releases/download";

const order = (page: Page) =>
  page.locator("[data-os-cards] > [data-os-card]").evaluateAll((cards) => cards.map((c) => (c as HTMLElement).dataset.osCard));
const loaded = (page: Page) => expect(page.locator("[data-releases]")).not.toHaveAttribute("data-state", "loading");
const card = (page: Page, key: string) => page.locator(`[data-os-card="${key}"]`);
const line = (page: Page) => page.locator("[data-release-line]");

async function noSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} ${n.failureSummary ?? ""}`).slice(0, 3).join(" | ")}`);
  expect(serious).toEqual([]);
}

test.describe("on Windows", () => {
  test.use({ userAgent: WINDOWS_UA });

  test("the Windows card comes first and is marked as recommended", async ({ page }) => {
    await mockReleases(page);
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
    await mockReleases(page);
    await page.goto("/download");
    await expect.poll(() => order(page)).toEqual(["linux", "windows", "macos", "mobile"]);
    await expect(card(page, "linux").locator("[data-recommended-badge]")).toBeVisible();
  });
});

test.describe("on Android", () => {
  test.use({ userAgent: ANDROID_UA });

  test("the mobile card moves to the front", async ({ page }) => {
    await mockReleases(page);
    await page.goto("/download");
    await expect.poll(() => order(page)).toEqual(["mobile", "windows", "linux", "macos"]);
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("a note links to the releases on GitHub; the web app and self-host cards stay", async ({ page }) => {
    await page.goto("/download");
    const note = page.locator("[data-releases-nojs]");
    await expect(note).toBeVisible();
    await expect(note).toContainText("Releases are listed on GitHub");
    await expect(note.getByRole("link", { name: /the releases of the desktop app/ })).toHaveAttribute("href", "https://github.com/just-tavrn/tavrn-web/releases");
    await expect(page.locator("[data-releases]")).toBeHidden();
    await expect(line(page)).toBeHidden();
    await expect(page.locator("a[download]:visible")).toHaveCount(0);
    for (const name of ["Use it in the browser", "Self-host a node"]) await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    const host = page.locator("[data-selfhost-card]");
    await expect(host.locator("pre")).toHaveText("ghcr.io/just-tavrn/tavrn-node");
    await expect(host.getByRole("link", { name: /release page on GitHub/ })).toHaveAttribute("href", "https://github.com/just-tavrn/tavrn-node/releases");
  });
});

test.describe("stable only", () => {
  test.beforeEach(async ({ page }) => {
    await mockReleases(page, { web: { body: scenarios.stableOnly() } });
    await page.goto("/download");
    await loaded(page);
  });

  test("the release with download links, no tabs, no beta notes", async ({ page }) => {
    await expect(line(page)).toHaveText("Version 0.3.0 · released November 1, 2026");
    await expect(line(page).locator("time")).toHaveAttribute("datetime", "2026-11-01T12:00:00Z");
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(page.locator("[data-beta-note]")).toBeHidden();
    await expect(page.locator("[data-beta-badge]:visible")).toHaveCount(0);
    await expect(page.locator("[data-note-private], [data-note-none]")).toHaveCount(2);
    await expect(page.locator("[data-note-private]:visible, [data-note-none]:visible")).toHaveCount(0);
    const installer = card(page, "windows").getByRole("link", { name: /Installer \(\.exe\)/ });
    await expect(installer).toHaveAttribute("href", `${DL}/v0.3.0/Tavrn_0.3.0_x64-setup.exe`);
    await expect(installer).toHaveAttribute("download", "");
    await expect(installer).toContainText("9.8 MB");
    await expect(installer).toHaveClass(/btn-primary/);
    await expect(card(page, "windows").getByRole("link", { name: /Windows Installer package \(\.msi\)/ })).toHaveClass(/btn-secondary/);
    await expect(card(page, "macos").getByText("Coming later")).toBeVisible();
    await expect(card(page, "mobile").getByText("Coming later")).toBeVisible();
    await expect(card(page, "windows").getByText("Coming later")).toBeHidden();
    await expect(page.getByRole("link", { name: /Release notes for 0\.3\.0/ })).toHaveAttribute("href", "https://github.com/just-tavrn/tavrn-web/releases/tag/v0.3.0");
    await expect(page.getByRole("link", { name: /All releases/ })).toHaveAttribute("href", "https://github.com/just-tavrn/tavrn-web/releases");
  });

  test("Linux lists the Electron AppImage and .deb, no .rpm", async ({ page }) => {
    const linux = card(page, "linux");
    await expect(linux.locator(".dl-button")).toHaveCount(2);
    await expect(linux.getByRole("link", { name: /AppImage/ })).toContainText("118 MB");
    await expect(linux.getByRole("link", { name: /\.deb/ })).toHaveAttribute("href", `${DL}/v0.3.0/tavrn_0.3.0_amd64.deb`);
    await expect(linux).not.toContainText(".rpm");
    await expect(linux.locator("[data-linux-note]")).toBeVisible();
    await expect(linux.locator("[data-linux-note]")).toContainText("Built with Electron.");
    await expect(linux.locator("[data-linux-note]")).toContainText("adds the app to your menu");
    await expect(linux.locator("[data-later]")).toBeHidden();
  });

  test("Windows offers the Electron build only as a secondary disclosure", async ({ page }) => {
    const windows = card(page, "windows");
    await expect(windows.locator(".dl-button")).toHaveCount(2);
    await expect(windows.locator(".dl-button", { hasText: /electron/i })).toHaveCount(0);
    const alt = windows.locator("details[data-alt-build]");
    await expect(alt).not.toHaveAttribute("open");
    const summary = alt.locator("summary");
    await expect(summary).toHaveText("Problems with the standard app? Alternative build (Electron)");
    expect(await summary.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeLessThan(15);
    await summary.click();
    await expect(alt).toContainText("WebView2");
    const link = alt.getByRole("link", { name: "Electron build: Installer (.exe)" });
    await expect(link).toHaveAttribute("href", `${DL}/v0.3.0/tavrn-electron_0.3.0_x64-setup.exe`);
    await expect(alt).toContainText("96.4 MB");
    await expect(alt.locator(".btn")).toHaveCount(0);
    await expect(page.locator("details[data-alt-build]:visible")).toHaveCount(1);
  });

  test("the verification details: GitHub's checksums, the command, the updater notes and the warnings", async ({ page }) => {
    const windows = card(page, "windows");
    await windows.getByText("Verify the download").click();
    await expect(windows.locator("pre")).toHaveText("Get-FileHash .\\Tavrn_0.3.0_x64-setup.exe -Algorithm SHA256");
    await expect(windows.getByLabel("SHA-256 of Tavrn_0.3.0_x64-setup.exe")).toHaveText(/^[a-f0-9]{64}$/);
    await expect(windows.locator(".sums dt")).toHaveText(["Tavrn_0.3.0_x64-setup.exe", "Tavrn_0.3.0_x64_en-US.msi", "tavrn-electron_0.3.0_x64-setup.exe"]);
    await expect(windows.getByText("signatures for the built-in updater")).toBeVisible();
    await expect(windows.getByText("not code-signed yet")).toBeVisible();
    await expect(windows.getByText("updates itself from latest.yml")).toBeVisible();
    const linux = card(page, "linux");
    await linux.getByText("Verify the download").click();
    await expect(linux.locator("pre").first()).toHaveText("sha256sum Tavrn-0.3.0.AppImage");
    await expect(linux.locator("pre").last()).toHaveText("chmod +x Tavrn-0.3.0.AppImage");
    await expect(linux.getByText("updates itself from latest-linux.yml")).toBeVisible();
    // The Electron packages carry no Tauri signature: no .sig note on Linux.
    await expect(linux.locator("[data-signature-note]")).toBeHidden();
    await expect(page.locator('[data-os-card="macos"] details.verify')).toBeHidden();
  });

  test("the browser and self-host cards", async ({ page }) => {
    const web = page.locator("[data-web-card]");
    await expect(web.getByRole("link", { name: "Open the web app" })).toHaveAttribute("href", "/app");
    const host = page.locator("[data-selfhost-card]");
    await expect(host.locator("pre")).toHaveText("ghcr.io/just-tavrn/tavrn-node:0.2.0");
    await expect(host).toContainText("Version 0.2.0, the newest release of the node.");
    await expect(host.getByRole("link", { name: "Read the install guide" })).toHaveAttribute("href", "/docs/admins/install/");
  });

  test("no serious axe findings with the details open", async ({ page }) => {
    for (const summary of await page.locator("details:visible > summary").all()) await summary.click();
    await noSeriousAxe(page);
  });
});

test("beta only (today's state): the beta with its badge and notes, the release without installers ignored", async ({ page }) => {
  await mockReleases(page);
  await page.goto("/download");
  await loaded(page);
  await expect(line(page)).toHaveText("Version 0.3.0-rc.1 · released October 10, 2026");
  await expect(page.getByRole("tablist")).toHaveCount(0);
  const note = page.locator("[data-beta-note]");
  await expect(note).toContainText("Beta versions are for testing: they may contain bugs");
  await expect(note).toContainText("updates itself to later versions");
  await expect(note.getByText("There is no stable release yet.")).toBeVisible();
  await expect(card(page, "windows").locator("[data-beta-badge]")).toHaveText("Beta");
  await expect(card(page, "linux").locator("[data-beta-badge]")).toBeVisible();
  await expect(card(page, "macos").locator("[data-beta-badge]")).toBeHidden();
  await expect(card(page, "windows").getByRole("link", { name: /Installer \(\.exe\)/ })).toHaveAttribute("href", `${DL}/v0.3.0-rc.1/Tavrn_0.3.0-rc.1_x64-setup.exe`);
  await expect(page.locator("a[download]")).toHaveCount(5);
  await expect(page.locator('[data-releases] a[href*="v0.2.0"]')).toHaveCount(0);
  await noSeriousAxe(page);
});

test.describe("stable and a newer beta", () => {
  test.beforeEach(async ({ page }) => {
    await mockReleases(page, { web: { body: scenarios.both() } });
  });

  test("two tabs, stable selected; a click swaps the whole card set to the beta", async ({ page }) => {
    await page.goto("/download");
    await loaded(page);
    const tablist = page.getByRole("tablist", { name: "Release channel" });
    const stable = tablist.getByRole("tab", { name: "Stable 0.3.0" });
    const beta = tablist.getByRole("tab", { name: "Beta 0.4.0-beta.1" });
    await expect(stable).toHaveAttribute("aria-selected", "true");
    await expect(beta).toHaveAttribute("aria-selected", "false");
    await expect(beta).toHaveAccessibleDescription("pre-release");
    await expect(beta).toHaveAttribute("title", "pre-release");
    const panel = page.getByRole("tabpanel");
    await expect(panel).toHaveAccessibleName("Stable 0.3.0");
    await expect(line(page)).toHaveText("Version 0.3.0 · released November 1, 2026");
    await expect(page.locator("[data-beta-note]")).toBeHidden();
    await expect(page.locator("[data-beta-badge]:visible")).toHaveCount(0);
    await expect(card(page, "windows").getByRole("link", { name: /Installer \(\.exe\)/ })).toHaveAttribute("href", `${DL}/v0.3.0/Tavrn_0.3.0_x64-setup.exe`);

    await beta.click();
    await expect(beta).toHaveAttribute("aria-selected", "true");
    await expect(stable).toHaveAttribute("aria-selected", "false");
    await expect(panel).toHaveAccessibleName("Beta 0.4.0-beta.1");
    await expect(line(page)).toHaveText("Version 0.4.0-beta.1 · released November 20, 2026");
    await expect(page.locator("[data-beta-note]")).toContainText("Beta versions are for testing");
    await expect(page.locator("[data-no-stable]")).toBeHidden();
    await expect(card(page, "windows").locator("[data-beta-badge]")).toBeVisible();
    await expect(card(page, "windows").getByRole("link", { name: /Installer \(\.exe\)/ })).toHaveAttribute("href", `${DL}/v0.4.0-beta.1/Tavrn_0.4.0-beta.1_x64-setup.exe`);
    await card(page, "linux").getByText("Verify the download").click();
    await expect(card(page, "linux").locator("pre").first()).toHaveText("sha256sum Tavrn-0.4.0-beta.1.AppImage");
    await expect(page.getByRole("link", { name: /Release notes for 0\.4\.0-beta\.1/ })).toHaveAttribute("href", /\/tag\/v0\.4\.0-beta\.1$/);
    // Nothing is remembered: a new visit starts on the stable tab.
    await page.reload();
    await expect(page.getByRole("tab", { name: "Stable 0.3.0" })).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  });

  test("arrow keys, Home and End move between the tabs and select them", async ({ page }) => {
    await page.goto("/download");
    await loaded(page);
    const stable = page.getByRole("tab", { name: /^Stable/ });
    const beta = page.getByRole("tab", { name: /^Beta/ });
    await expect(stable).toHaveAttribute("tabindex", "0");
    await expect(beta).toHaveAttribute("tabindex", "-1");
    await stable.focus();
    await page.keyboard.press("ArrowRight");
    await expect(beta).toBeFocused();
    await expect(beta).toHaveAttribute("aria-selected", "true");
    await expect(beta).toHaveAttribute("tabindex", "0");
    await expect(line(page)).toContainText("0.4.0-beta.1");
    await page.keyboard.press("ArrowRight");
    await expect(stable).toBeFocused();
    await expect(stable).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(beta).toBeFocused();
    await page.keyboard.press("Home");
    await expect(stable).toBeFocused();
    await expect(line(page)).toContainText("Version 0.3.0 ·");
    await page.keyboard.press("End");
    await expect(beta).toBeFocused();
    await expect(beta).toHaveAttribute("aria-selected", "true");
  });

  test("#beta in the address selects the beta tab", async ({ page }) => {
    await page.goto("/download#beta");
    await loaded(page);
    await expect(page.getByRole("tab", { name: /^Beta/ })).toHaveAttribute("aria-selected", "true");
    await expect(line(page)).toContainText("0.4.0-beta.1");
    await expect(card(page, "linux").locator("[data-beta-badge]")).toBeVisible();
  });

  test("no serious axe findings on either tab", async ({ page }) => {
    await page.goto("/download");
    await loaded(page);
    await noSeriousAxe(page);
    await page.getByRole("tab", { name: /^Beta/ }).click();
    for (const summary of await page.locator("details:visible > summary").all()) await summary.click();
    await noSeriousAxe(page);
  });
});

test("a beta older than the stable release: only the stable release, no tabs", async ({ page }) => {
  await mockReleases(page, { web: { body: scenarios.stableNewerThanBeta() } });
  await page.goto("/download");
  await loaded(page);
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(line(page)).toHaveText("Version 0.3.0 · released November 1, 2026");
  await expect(page.locator("[data-beta-note]")).toBeHidden();
  await expect(page.locator('a[download][href*="rc.1"]')).toHaveCount(0);
});

const noRelease = async (page: Page, error: boolean) => {
  await loaded(page);
  await expect(line(page)).toHaveText("There is no release yet.");
  const note = page.locator("[data-note-none]");
  await expect(note.getByRole("link", { name: /See the releases on GitHub/ })).toHaveAttribute("href", "https://github.com/just-tavrn/tavrn-web/releases");
  if (error) await expect(note).toContainText("The release list could not be loaded.");
  else await expect(note.locator("[data-load-error]")).toBeHidden();
  await expect(page.locator("[data-os-cards]")).toBeHidden();
  await expect(page.locator("a[download], .dl-button, button:disabled")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Release notes/ })).toHaveCount(0);
};

test("no usable release (a draft, a release with only the web bundle): \"no release yet\" and the link", async ({ page }) => {
  await mockReleases(page, { web: { body: scenarios.none() } });
  await page.goto("/download");
  await noRelease(page, false);
  await noSeriousAxe(page);
});

test("the proxy answers 404 (no token, private repository): the quiet \"no release yet\" and the edge image", async ({ page }) => {
  const hits = await mockReleases(page, { web: { status: 404 }, node: { status: 404 }, repo: { status: 404 } });
  await page.goto("/download");
  await noRelease(page, false);
  expect(hits).toEqual({ web: 1, node: 1, repo: 1 });
  const host = page.locator("[data-selfhost-card]");
  await expect(host.locator("pre")).toHaveText("ghcr.io/just-tavrn/tavrn-node:edge");
  await expect(host).toContainText("The node has no release yet: edge is built from the main branch");
});

for (const code of [401, 403]) {
  test(`the proxy answers ${code}: "no release yet" without an error line`, async ({ page }) => {
    await mockReleases(page, { web: { status: code } });
    await page.goto("/download");
    await noRelease(page, false);
  });
}

test("a server error says the list could not be loaded", async ({ page }) => {
  await mockReleases(page, { web: { status: 502, body: { message: "Bad Gateway" } } });
  await page.goto("/download");
  await noRelease(page, true);
  await noSeriousAxe(page);
});

test("a network error says the list could not be loaded", async ({ page }) => {
  await mockReleases(page, { web: "abort", node: "abort", repo: "abort" });
  await page.goto("/download");
  await noRelease(page, true);
  await expect(page.locator("[data-selfhost-card] pre")).toHaveText("ghcr.io/just-tavrn/tavrn-node:edge");
});

test.describe("a private repository", () => {
  test("lists the release without download links, says why and links to GitHub", async ({ page }) => {
    await mockReleases(page, { repo: { body: repository(true) } });
    await page.goto("/download");
    await loaded(page);
    await expect(line(page)).toHaveText("Version 0.3.0-rc.1 · released October 10, 2026");
    const note = page.locator("[data-note-private]");
    await expect(note).toContainText("Downloads open once the project's repositories are public; until then the release is listed on GitHub for signed-in members.");
    await expect(note.getByRole("link", { name: /The releases on GitHub/ })).toHaveAttribute("href", "https://github.com/just-tavrn/tavrn-web/releases");
    await expect(page.locator("a[download]")).toHaveCount(0);
    await expect(page.locator(".dl-button")).toHaveCount(0);
    const windows = card(page, "windows");
    await expect(windows.locator(".dl-file")).toHaveCount(2);
    await expect(windows.locator(".dl-file").first()).toContainText("Installer (.exe)");
    await expect(windows.locator(".dl-file").first()).toContainText("9.8 MB");
    await windows.locator("details[data-alt-build] > summary").click();
    await expect(windows.locator("details[data-alt-build]")).toContainText("Electron build: Installer (.exe) · 64-bit (x64) · 96.4 MB");
    await windows.getByText("Verify the download").click();
    await expect(windows.locator(".sums dt").first()).toHaveText("Tavrn_0.3.0-rc.1_x64-setup.exe");
    await expect(page.locator("[data-selfhost-card]")).toContainText("The image can be pulled once the project's repositories are public");
    await noSeriousAxe(page);
  });

  test("a public repository gets the download links and no such note", async ({ page }) => {
    await mockReleases(page, { repo: { body: repository(false) } });
    await page.goto("/download");
    await loaded(page);
    await expect(page.locator("[data-note-private]")).toBeHidden();
    await expect(page.locator("a[download]")).toHaveCount(5);
    await expect(page.locator("[data-selfhost-card]")).not.toContainText("pulled once");
  });
});

test("the node image: a pre-release when the node has no stable release, marked as such", async ({ page }) => {
  await mockReleases(page, { node: { body: [nodeRelease("v0.3.0-rc.1", { prerelease: true }), nodeRelease("v0.4.0", { draft: true })] } });
  await page.goto("/download");
  await loaded(page);
  const host = page.locator("[data-selfhost-card]");
  await expect(host.locator("pre")).toHaveText("ghcr.io/just-tavrn/tavrn-node:0.3.0-rc.1");
  await expect(host).toContainText("Version 0.3.0-rc.1 is a pre-release: the node has no stable release yet.");
});

test("while the list loads, the cards keep their place: nothing below them jumps", async ({ page }) => {
  let release: () => void = () => {};
  const delay = new Promise<void>((r) => (release = r));
  await mockReleases(page, { web: { body: scenarios.stableOnly(), delay } });
  await page.goto("/download");
  await expect(line(page)).toHaveText("Loading the releases…");
  await expect(page.locator("[data-releases]")).toHaveAttribute("data-state", "loading");
  const top = () => page.locator("#verify").evaluate((el) => el.getBoundingClientRect().top + scrollY);
  const before = await top();
  release();
  await loaded(page);
  await expect(line(page)).toHaveAttribute("aria-live", "polite");
  await expect(line(page)).toContainText("Version 0.3.0");
  expect(Math.abs((await top()) - before)).toBeLessThanOrEqual(8);
});

test("loading the releases asks only this site: the downloads are plain links, nothing is fetched from GitHub", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith(`${origin}/`) && !r.url().startsWith(`${NODE}/`)) foreign.push(r.url());
  });
  await mockRuntime(page);
  const hits = await mockReleases(page, { web: { body: scenarios.both() } });
  await page.goto("/download");
  await loaded(page);
  await page.getByRole("tab", { name: /^Beta/ }).click();
  await page.waitForLoadState("networkidle");
  expect(foreign).toEqual([]);
  // One request per proxy, also after switching tabs.
  expect(hits).toEqual({ web: 1, node: 1, repo: 1 });
});
