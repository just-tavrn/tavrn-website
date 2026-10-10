// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "@playwright/test";

test("the first Tab shows the skip link, and it moves to the main content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.locator(".skip-link");
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});

test("the menu opens and closes with the keyboard on narrow screens", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: "Menu" });
  const desktop = !(await button.isVisible());
  if (desktop) {
    // Wide screens show the navigation directly.
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Download" })).toBeVisible();
    return;
  }
  await page.keyboard.press("Tab"); // skip link
  await page.keyboard.press("Tab"); // logo
  await page.keyboard.press("Tab"); // menu button
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const panel = page.locator("#mobile-menu");
  await expect(panel).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("link").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();
  await expect(button).toBeFocused();
  await page.keyboard.press("Space");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Space");
  await expect(button).toHaveAttribute("aria-expanded", "false");
});

test("the tour's tabs follow the arrow keys, Home and End", async ({ page }) => {
  await page.goto("/");
  const tab = (name: string) => page.getByRole("tab", { name });
  await tab("Chat").focus();
  await expect(tab("Chat")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(tab("Voice")).toBeFocused();
  await expect(tab("Voice")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#panel-voice")).toBeVisible();
  await expect(page.locator("#panel-chat")).toBeHidden();
  await page.keyboard.press("End");
  await expect(tab("Search")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(tab("Chat")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(tab("Search")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tab("Chat")).toBeFocused();
  // Only the selected tab is in the Tab order.
  await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
});

test("the federation diagram responds to the keyboard", async ({ page }) => {
  await page.goto("/");
  const diagram = page.locator("[data-federation]");
  const text = diagram.locator("[data-fed-text]");
  await expect(diagram).toHaveAttribute("data-mode", "room");
  const home = page.getByRole("button", { name: "Alice's home node" });
  await home.focus();
  await page.keyboard.press("Enter");
  await expect(home).toHaveAttribute("aria-pressed", "true");
  await expect(diagram).toHaveAttribute("data-mode", "home");
  await expect(text).toContainText("Alice's account lives on her home node");
  await expect(text).toHaveAttribute("aria-live", "polite");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "A signed invite" })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(diagram).toHaveAttribute("data-mode", "notify");
  await expect(text).toContainText("signed note");
  await expect(home).toHaveAttribute("aria-pressed", "false");
});

test("the encryption switch flips between readable text and sealed messages", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("switch", { name: "Show what the node sees" });
  const box = page.locator("[data-e2ee]");
  await expect(box.getByText("Raid tonight at nine?")).toBeVisible();
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(box.getByText("Raid tonight at nine?")).toBeHidden();
  await expect(box.locator(".cipher").first()).toBeVisible();
  await expect(box.getByText("What the node sees", { exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(box.getByText("Raid tonight at nine?")).toBeVisible();
});

test("the navigation lists the sections in order, with Report a problem before GitHub", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: "Menu" });
  if (await button.isVisible()) await button.click();
  const list = (await button.isVisible()) ? page.locator("#mobile-menu") : page.locator("header .nav-list");
  // Visible labels only (the Status link's hidden state text and the external-link hint are left out).
  const names = await list.getByRole("link").evaluateAll((links) =>
    links.map((l) =>
      [...l.childNodes]
        .map((n) => (n instanceof HTMLElement && /sr-only|status-state/.test(n.className) ? "" : (n.textContent ?? "")))
        .join("")
        .replace(/\s+/g, " ")
        .trim(),
    ),
  );
  expect(names).toEqual(["Features", "Download", "Docs", "Status", "Report a problem", "GitHub"]);
  await expect(list.getByRole("link", { name: "Report a problem" })).toHaveAttribute("href", "/report");
  await expect(list.getByRole("link", { name: /^Status/ })).toHaveAttribute("href", "/status");
});

test("the header stays on one line from 1024 px and collapses into the menu below", async ({ page, isMobile }) => {
  test.skip(isMobile, "viewport sizes are a desktop concern");
  for (const width of [1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/download");
    await expect(page.locator("header .nav-list")).toBeVisible();
    await expect(page.getByRole("button", { name: "Menu" })).toBeHidden();
    const tops = await page.locator("header .nav-list > li").evaluateAll((items) => items.map((i) => Math.round(i.getBoundingClientRect().top)));
    expect(new Set(tops).size, `one row at ${width}px`).toBe(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }
  for (const width of [768, 1000]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/download");
    await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
    await expect(page.locator("header .nav-list")).toBeHidden();
  }
});

test("the docs header links Report a problem too", async ({ page, isMobile }) => {
  test.skip(isMobile, "Starlight shows these links in its menu on phones");
  await page.goto("/docs/");
  await expect(page.locator("header").getByRole("link", { name: "Report a problem" })).toHaveAttribute("href", "/report");
});
