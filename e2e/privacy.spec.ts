// SPDX-License-Identifier: Apache-2.0
// No request leaves the origin except the status checks to the configured node, nothing is stored in the browser,
// the product name is never machine-translated, and the production Content-Security-Policy (deploy/Caddyfile)
// blocks nothing the site needs. /config.json and the node are mocked (e2e/mocks.ts), so the suite stays hermetic.
import { expect, test } from "@playwright/test";
import { defaultNodeUrl, enforceProductionCsp, revealAll } from "./helpers";
import { mockRuntime, NODE } from "./mocks";
import { routes } from "./routes";

for (const route of routes) {
  test(`${route.path} stays on its origin and stores nothing`, async ({ page, context, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const foreign: string[] = [];
    page.on("request", (r) => {
      const url = r.url();
      if (!url.startsWith(`${origin}/`) && !/^(data|blob):/.test(url)) foreign.push(url);
    });
    // The Status link's live dot asks the node named in /config.json for /healthz on every page; the status page
    // also asks /readyz and /api/v1/node. Nothing else may leave the origin.
    await mockRuntime(page);
    await page.goto(route.path);
    await revealAll(page);
    await page.waitForLoadState("networkidle");
    const allowed = route.path === "/status" ? ["/healthz", "/readyz", "/api/v1/node"] : ["/healthz"];
    expect(foreign.filter((u) => !(u.startsWith(`${NODE}/`) && allowed.includes(new URL(u).pathname)))).toEqual([]);
    expect(foreign.some((u) => u === `${NODE}/healthz`)).toBe(true);
    expect(await context.cookies()).toEqual([]);
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  });

  test(`${route.path} works under the production CSP`, async ({ page }) => {
    const violations = await enforceProductionCsp(page);
    // The node of the Caddyfile's default TAVRN_NODE_URL (allowed in connect-src), mocked after the CSP route.
    await mockRuntime(page, { nodeUrl: defaultNodeUrl() });
    await page.goto(route.path);
    await revealAll(page);
    expect(await violations()).toEqual([]);
  });
}

test("the docs search works under the production CSP and stores nothing", async ({ page }) => {
  const violations = await enforceProductionCsp(page);
  await page.goto("/docs/");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("dialog", { name: "Search" }).getByRole("textbox").fill("node");
  await expect(page.locator(".pagefind-ui__result").first()).toBeVisible();
  expect(await violations()).toEqual([]);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

for (const route of routes.filter((r) => !r.path.startsWith("/docs"))) {
  test(`${route.path} marks every mention of tavrn translate="no"`, async ({ page }) => {
    await page.goto(route.path);
    const offenders = await page.evaluate(() => {
      const found: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? "";
        const parent = node.parentElement;
        // <noscript> is raw text while JavaScript runs (the no-JS case is the page's own test in download.spec.ts).
        if (!parent || parent.closest("script, style, template, noscript")) continue;
        if (/\btavrn\b/i.test(text) && !parent.closest('[translate="no"]')) found.push(text.trim().slice(0, 80));
        if (/\bTavrn\b|\bTAVRN\b/.test(text) && !parent.closest('[translate="no"]')) found.push(`capitalized: ${text.trim().slice(0, 80)}`);
      }
      return found;
    });
    expect(offenders).toEqual([]);
  });
}
