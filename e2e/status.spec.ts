// SPDX-License-Identifier: Apache-2.0
// The status page and the live dot of the header's "Status" link against mocked runtime answers (e2e/mocks.ts):
// online, degraded, offline,
// refresh, the uptime history with and without Uptime Kuma, accessibility and the production CSP.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { defaultNodeUrl, enforceProductionCsp } from "./helpers";
import { HEALTH_OK, mockRuntime, READY_OK } from "./mocks";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const state = (page: Page) => page.locator("[data-ns-state]");
/** Every live dot of the site header (the navigation and the mobile menu each have one). */
const dots = (page: Page) => page.locator("header [data-status-dot]");

/** The header's "Status" link that is on screen: the navigation on wide screens, the opened menu on phones. */
async function statusLink(page: Page) {
  const menu = page.getByRole("button", { name: "Menu" });
  if (await menu.isVisible()) {
    if ((await menu.getAttribute("aria-expanded")) !== "true") await menu.click();
    return page.locator("#mobile-menu a[data-status-link]");
  }
  return page.locator("header .nav-list a[data-status-link]");
}

async function seriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} ${n.failureSummary ?? ""}`).slice(0, 3).join(" | ")}`);
}

test("an operational node: state, details, checks and capabilities", async ({ page }) => {
  await mockRuntime(page);
  await page.goto("/status");
  await expect(state(page)).toHaveText("Operational");
  await expect(state(page)).toHaveAttribute("aria-live", "polite");
  // Only the state line is a live region.
  await expect(page.locator(".node-status [aria-live]")).toHaveCount(1);
  const status = page.locator(".node-status");
  await expect(status).toHaveAttribute("data-state", "operational");
  await expect(status.locator(".ns-node")).toContainText("tavrn official");
  await expect(status.locator(".ns-node")).toContainText("tavrn.org");
  const field = (name: string) => status.locator(".ns-fields > div", { has: page.locator("dt", { hasText: name }) }).locator("dd");
  await expect(field("Software version")).toHaveText("0.2.0");
  await expect(field("Protocol version")).toHaveText("1");
  await expect(field("Sign-up")).toHaveText("Invite only");
  await expect(field("Voice")).toHaveText("Running");
  await expect(status.locator('[data-check="database"]')).toHaveText("Database: OK");
  await expect(status.locator('[data-check="livekit"]')).toHaveText("Voice server: OK");
  await expect(status.locator('[data-check="cache"]')).toHaveText("Shared cache: Not used");
  const caps = status.locator("details.ns-caps");
  await expect(caps.locator("summary")).toHaveText("Capabilities (5)");
  await caps.locator("summary").click();
  await expect(caps.getByText("mls.v1")).toBeVisible();
  const time = status.locator(".ns-time time");
  await expect(time).toHaveText(/\d{1,2}:\d{2}:\d{2}/);
  expect(Date.parse((await time.getAttribute("datetime"))!)).not.toBeNaN();
  // Names and domains the island renders are never machine-translated.
  const untranslatable = await page.evaluate(() => {
    const found: string[] = [];
    const walker = document.createTreeWalker(document.querySelector(".node-status")!, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (/tavrn/i.test(node.textContent ?? "") && !node.parentElement?.closest('[translate="no"]')) found.push(node.textContent!.trim());
    }
    return found;
  });
  expect(untranslatable).toEqual([]);
  await expect(dots(page)).toHaveCount(2);
  for (const dot of await dots(page).all()) await expect(dot).toHaveAttribute("data-state", "online");
  const link = await statusLink(page);
  await expect(link).toBeVisible();
  await expect(link).toHaveAccessibleName("Status: online");
  await expect(link).toHaveAttribute("href", "/status");
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

test("a degraded node: not ready (503) and voice restarting", async ({ page }) => {
  await mockRuntime(page, {
    healthz: { body: { status: "ok", voice: "restarting" } },
    readyz: { status: 503, body: { ready: false, database: true, livekit: false, cache: true } },
  });
  await page.goto("/status");
  await expect(state(page)).toHaveText("Degraded");
  const messages = page.locator("[data-ns-messages]");
  await expect(messages).toContainText("The node is running but not ready to serve requests.");
  await expect(messages).toContainText("Voice is restarting.");
  await expect(page.locator('[data-check="livekit"]')).toHaveText("Voice server: Not answering");
  await expect(page.locator('[data-check="cache"]')).toHaveText("Shared cache: OK");
  // The process answers /healthz, so the dot says online.
  await expect(dots(page).first()).toHaveAttribute("data-state", "online");
});

test("an unreachable node: the error in words, the dot offline", async ({ page }) => {
  await mockRuntime(page, { healthz: "abort", readyz: "abort", node: "abort" });
  await page.goto("/status");
  await expect(state(page)).toHaveText("Unreachable");
  await expect(page.locator("[data-ns-messages]")).toHaveText("The node could not be reached. It may be down, or your network blocks it.");
  await expect(dots(page).first()).toHaveAttribute("data-state", "offline");
  await expect(await statusLink(page)).toHaveAccessibleName("Status: offline");
});

test("without /config.json the page says so and the dot stays invisible", async ({ page }) => {
  await mockRuntime(page, { noConfig: true });
  await page.goto("/status");
  await expect(state(page)).toHaveText("The status page cannot load its configuration right now.");
  await expect(page.getByRole("button", { name: "Refresh now" })).toBeDisabled();
  await page.waitForLoadState("networkidle");
  for (const dot of await dots(page).all()) await expect(dot).not.toHaveAttribute("data-state");
  await expect(await statusLink(page)).toHaveAccessibleName("Status");
});

test("Refresh now checks again and the state follows", async ({ page }) => {
  const node = await mockRuntime(page);
  await page.goto("/status");
  await expect(state(page)).toHaveText("Operational");
  const before = node.hits.healthz!;
  node.set({ healthz: "abort", readyz: "abort", node: "abort" });
  await page.getByRole("button", { name: "Refresh now" }).click();
  await expect(state(page)).toHaveText("Unreachable");
  expect(node.hits.healthz).toBe(before + 1);
  node.set({
    healthz: { body: HEALTH_OK },
    readyz: { body: READY_OK },
    node: { body: { domain: "tavrn.org", version: "0.2.1", protocol: 1, capabilities: [], registration: "open" } },
  });
  await page.getByRole("button", { name: "Refresh now" }).click();
  await expect(state(page)).toHaveText("Operational");
  await expect(page.locator(".ns-fields")).toContainText("0.2.1");
  await expect(page.locator(".ns-fields")).toContainText("Open: anyone can create an account");
  expect(node.hits.healthz).toBe(before + 2);
});

test("the uptime history from Uptime Kuma: uptime, 90 checks, incidents as text", async ({ page }) => {
  await mockRuntime(page, { kuma: true });
  await page.goto("/status");
  const history = page.locator("section[data-history]");
  await expect(history).toHaveAttribute("data-history", "ready");
  const api = history.locator('[data-monitor="Node API"]');
  await expect(api.locator(".ns-uptime")).toContainText("97.12%");
  await expect(api.locator("svg rect")).toHaveCount(90);
  await expect(api.locator('svg rect[data-status="down"]')).toHaveCount(2);
  await expect(api.locator("svg")).toHaveAttribute("aria-label", /The last 90 checks of Node API, oldest first: 87 Up, 2 Down, 1 Pending/);
  const web = history.locator('[data-monitor="Web app"]');
  await expect(web.locator("svg rect")).toHaveCount(90);
  await expect(web.locator('svg rect[data-status="unknown"]')).toHaveCount(60);
  await expect(web.locator(".ns-uptime")).toContainText("100%");
  // Kuma 2 reports no 30-day value: no such column.
  await expect(history).not.toContainText("30 days");
  const incident = history.locator(".ns-incident");
  await expect(incident.locator(".ns-incident-title")).toHaveText("Voice degraded in Europe");
  // Markdown and HTML stay text.
  await expect(incident.locator(".ns-incident-text")).toHaveText("We are looking into **dropped calls**. <script>alert(1)</script>");
  await expect(incident.locator("time").first()).toHaveAttribute("datetime", "2026-10-10T08:15:00.000Z");
  await expect(history.getByRole("link", { name: "Full history on the status monitor" })).toHaveAttribute("href", "https://status.example/status/tavrn");
});

test("without Uptime Kuma the history says it is not available yet", async ({ page }) => {
  await mockRuntime(page);
  await page.goto("/status");
  await expect(state(page)).toHaveText("Operational");
  await expect(page.locator("section[data-history]")).toContainText("The uptime history is not available yet.");
});

test("an unexpected Kuma answer hides the history with a note", async ({ page }) => {
  await mockRuntime(page, { kuma: true });
  await page.route("**/uptime/api/status-page/tavrn", (route) => route.fulfill({ contentType: "application/json", body: '{"msg":"Status Page Not Found","ok":false}' }));
  await page.goto("/status");
  await expect(page.locator("section[data-history]")).toContainText("The uptime history could not be loaded right now.");
});

test("the status page has no serious axe findings, operational with history and unreachable", async ({ page }) => {
  await mockRuntime(page, { kuma: true });
  await page.goto("/status");
  await expect(page.locator("section[data-history]")).toHaveAttribute("data-history", "ready");
  await page.locator("details.ns-caps summary").click();
  expect(await seriousAxe(page)).toEqual([]);

  const other = await page.context().newPage();
  await mockRuntime(other, { healthz: "abort", readyz: "abort", node: "abort" });
  await other.goto("/status");
  await expect(state(other)).toHaveText("Unreachable");
  expect(await seriousAxe(other)).toEqual([]);
});

test("the status page keeps its layout while the check runs", async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await mockRuntime(page);
  await page.route("https://node.example/healthz", async (route) => {
    await gate;
    await route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(HEALTH_OK) });
  });
  await page.goto("/status");
  await expect(state(page)).toHaveText("Checking the node…");
  const box = async () => (await page.locator(".ns-head").boundingBox())!.height;
  const before = await box();
  release();
  await expect(state(page)).toHaveText("Operational");
  expect(Math.abs((await box()) - before)).toBeLessThanOrEqual(2);
});

test("the status page and the dot work under the production CSP with the default node", async ({ page }) => {
  const violations = await enforceProductionCsp(page);
  // The Caddyfile's default TAVRN_NODE_URL, mocked (registered after the CSP route, so it wins).
  await mockRuntime(page, { nodeUrl: defaultNodeUrl(), kuma: true });
  await page.goto("/status");
  await expect(state(page)).toHaveText("Operational");
  await expect(page.locator("section[data-history]")).toHaveAttribute("data-history", "ready");
  await expect(dots(page).first()).toHaveAttribute("data-state", "online");
  expect(await violations()).toEqual([]);
});

test("the Status link keeps its size when the dot appears, and carries no separate pill", async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await mockRuntime(page);
  await page.route("https://node.example/healthz", async (route) => {
    await gate;
    await route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(HEALTH_OK) });
  });
  await page.goto("/download");
  const link = await statusLink(page);
  const before = (await link.boundingBox())!;
  await expect(link.locator("[data-status-dot]")).not.toHaveAttribute("data-state");
  release();
  await expect(link.locator("[data-status-dot]")).toHaveAttribute("data-state", "online");
  const after = (await link.boundingBox())!;
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5);
  await expect(page.locator("[data-pill-link], [data-status-pill]")).toHaveCount(0);
});

test("the docs header's Status link carries the dot as well", async ({ page }) => {
  await mockRuntime(page);
  await page.goto("/docs/");
  const docsDots = page.locator("a[data-status-link] [data-status-dot]");
  await expect(docsDots.first()).toHaveAttribute("data-state", "online");
  await expect(page.locator("a[data-status-link] [data-status-state]").first()).toHaveText(": online");
  // Wide screens show the docs header's links (on phones they sit in Starlight's menu).
  const visible = page.locator("a[data-status-link]").filter({ visible: true });
  if ((await visible.count()) > 0) await expect(visible.first()).toHaveAccessibleName("Status: online");
});
