// SPDX-License-Identifier: Apache-2.0
// The wiki: the landing with its three audiences, one page of every group, the anchors of the configuration
// reference, the search (Pagefind), keyboard navigation of the sidebar, and axe on these routes.
import { expect, type Page, test } from "@playwright/test";
import { seriousAxeFindings } from "../helpers";

const PAGES = [
  { path: "/docs/", heading: "tavrn docs" },
  { path: "/docs/users/account/", heading: "Your account", group: "Users" },
  { path: "/docs/admins/install/", heading: "Install with Docker Compose", group: "Node admins" },
  { path: "/docs/admins/configuration-reference/", heading: "Configuration reference", group: "Node admins" },
  { path: "/docs/developers/protocol/core/", heading: "tavrn protocol (draft v1)", group: "Developers" },
] as const;

/** On narrow screens the sidebar sits behind the menu button. */
async function openSidebar(page: Page): Promise<void> {
  const menu = page.getByRole("button", { name: "Menu" });
  if (await menu.isVisible()) {
    await menu.focus();
    await page.keyboard.press("Enter");
  }
  await expect(page.locator("#starlight__sidebar")).toBeVisible();
}

test("the docs landing leads to the three audiences", async ({ page }) => {
  await page.goto("/docs/");
  await expect(page.locator("h1")).toHaveText("tavrn docs");
  const cards = [
    ["Users", "/docs/users/getting-started/"],
    ["Node admins", "/docs/admins/overview/"],
    ["Developers", "/docs/developers/overview/"],
  ] as const;
  for (const [title, href] of cards) await expect(page.getByRole("link", { name: new RegExp(`^${title}`) })).toHaveAttribute("href", href);
  await expect(page.getByRole("link", { name: "Discussions" })).toHaveAttribute("href", /\/discussions$/);
});

for (const { path, heading, ...rest } of PAGES.filter((p) => "group" in p)) {
  test(`${path} renders in the ${"group" in rest ? rest.group : ""} group of the sidebar`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("h1")).toHaveText(heading);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.{20,}/);
    await openSidebar(page);
    const current = page.locator('#starlight__sidebar a[aria-current="page"]');
    await expect(current).toHaveAttribute("href", path);
    // The group of the current page is open.
    const group = page.locator("#starlight__sidebar details", { has: page.locator('a[aria-current="page"]') }).first();
    await expect(group).toHaveAttribute("open", "");
  });
}

test("synced pages link to their source repository for edits", async ({ page }) => {
  await page.goto("/docs/admins/install/");
  await expect(page.getByRole("link", { name: "Edit page" })).toHaveAttribute(
    "href",
    "https://github.com/just-tavrn/tavrn-node/edit/main/docs/HANDBOOK.md",
  );
  await expect(page.getByText("This page is generated from")).toBeVisible();
});

test("the configuration reference has an anchor per variable", async ({ page }) => {
  await page.goto("/docs/admins/configuration-reference/#TAVRN_DOMAIN");
  const anchor = page.locator("#TAVRN_DOMAIN");
  await expect(anchor).toHaveAttribute("href", "#TAVRN_DOMAIN");
  await expect(anchor).toBeInViewport();
  await expect(page.locator("#TAVRN_PUBLIC_URL")).toBeAttached();
  await expect(page.getByRole("heading", { level: 2, name: "Voice, video and screen sharing" })).toBeAttached();
});

for (const [query, expected] of [
  ["recovery key", "/docs/users/account/"],
  ["TAVRN_DOMAIN", "/docs/admins/configuration-reference/"],
] as const) {
  test(`the search finds "${query}"`, async ({ page }) => {
    await page.goto("/docs/");
    await page.getByRole("button", { name: "Search" }).click();
    const dialog = page.getByRole("dialog", { name: "Search" });
    await dialog.getByRole("textbox").fill(query);
    await expect(dialog.locator(".pagefind-ui__result").first()).toBeVisible();
    const links = dialog.locator(".pagefind-ui__result-link");
    await expect(async () => {
      const hrefs = await links.evaluateAll((els) => els.map((a) => new URL((a as HTMLAnchorElement).href).pathname));
      expect(hrefs).toContain(expected);
    }).toPass();
  });
}

test("the sidebar works with the keyboard", async ({ page }) => {
  await page.goto("/docs/");
  await openSidebar(page);
  const sidebar = page.locator("#starlight__sidebar");
  const users = sidebar.locator("summary", { hasText: "Users" });
  const group = sidebar.locator("details", { has: page.locator("summary", { hasText: "Users" }) }).first();
  await expect(group).not.toHaveAttribute("open", "");
  await users.focus();
  await page.keyboard.press("Enter");
  await expect(group).toHaveAttribute("open", "");
  await page.keyboard.press("Tab");
  const first = group.getByRole("link", { name: "Getting started" });
  await expect(first).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/docs\/users\/getting-started\/$/);
  await expect(page.locator("h1")).toHaveText("Getting started");
  // Space closes the group again.
  await openSidebar(page);
  const again = page.locator("#starlight__sidebar summary", { hasText: "Node admins" });
  const admins = page.locator("#starlight__sidebar details", { has: page.locator("summary", { hasText: "Node admins" }) }).first();
  await again.focus();
  await page.keyboard.press("Space");
  await expect(admins).toHaveAttribute("open", "");
  await page.keyboard.press("Space");
  await expect(admins).not.toHaveAttribute("open", "");
});

for (const { path } of PAGES) {
  test(`${path} has no serious or critical axe findings`, async ({ page }) => {
    await page.goto(path);
    // Expressive Code makes overflowing code blocks focusable once it has measured them.
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".expressive-code pre")].every((pre) => pre.scrollWidth <= pre.clientWidth || pre.hasAttribute("tabindex")),
    );
    expect(await seriousAxeFindings(page)).toEqual([]);
  });
}
