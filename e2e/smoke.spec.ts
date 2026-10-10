// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "@playwright/test";
import { routes } from "./routes";

for (const route of routes) {
  test(`${route.path} renders its heading`, async ({ page }) => {
    const response = await page.goto(route.path);
    expect(response?.status()).toBe("status" in route ? route.status : 200);
    await expect(page.locator("h1").first()).toHaveText(route.heading);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveTitle(/tavrn/);
    // No horizontal scrolling at any width.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("the landing page links download, the web app and the docs", async ({ page }) => {
  await page.goto("/");
  const hero = page.locator("section").first();
  await expect(hero.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/download");
  await expect(hero.getByRole("link", { name: "Open the web app" })).toHaveAttribute("href", "/app");
  await expect(page.locator("#features")).toBeAttached();
  // The decorative brand background loads eagerly but with low priority, so it never competes with the LCP.
  const hero_bg = hero.locator("img.hero-bg");
  await expect(hero_bg).toHaveAttribute("fetchpriority", "low");
  await expect(hero_bg).toHaveAttribute("alt", "");
  // The hero screenshot is the LCP image: eager and high priority; the others load lazily.
  const hero_img = hero.locator("picture img").first();
  await expect(hero_img).toHaveAttribute("loading", "eager");
  await expect(hero_img).toHaveAttribute("fetchpriority", "high");
  for (const img of await page.locator("#tour img").all()) await expect(img).toHaveAttribute("loading", "lazy");
});

test("pages carry canonical, hreflang and Open Graph tags", async ({ page }) => {
  await page.goto("/download");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://tavrn.org/download/");
  await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute("href", "https://tavrn.org/download/");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://tavrn.org/og.png");
});

test("the legal pages carry the provider's details as template actions for the container", async ({ page }) => {
  // The container (Caddy's templates, deploy/Caddyfile) fills these in at request time; the preview serves the
  // pages as built, so the actions show as they are (deploy/test/legal-templates.sh checks the rendered pages).
  const email = '{{env "TAVRN_CONTACT_EMAIL"}}';
  await page.goto("/legal/imprint");
  const address = page.locator("address");
  await expect(address).toHaveAttribute("translate", "no");
  await expect(address).toContainText('{{env "TAVRN_IMPRINT_NAME"}}');
  await expect(address).toContainText('{{env "TAVRN_IMPRINT_COUNTRY"}}');
  await expect(page.getByRole("link", { name: email })).toHaveAttribute("href", `mailto:${email}`);
  await page.goto("/legal/privacy");
  await expect(page.locator("address").getByRole("link", { name: email })).toHaveAttribute("href", `mailto:${email}`);
  await expect(page.locator('code[translate="no"]', { hasText: '{{env "TAVRN_NODE_HOST"}}' })).toBeVisible();
});
