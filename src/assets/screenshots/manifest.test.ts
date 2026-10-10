// SPDX-License-Identifier: Apache-2.0
import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isPhone, screenshots } from "./manifest";

const dir = dirname(fileURLToPath(import.meta.url));

describe("screenshot manifest", () => {
  it("has a meaningful alt text and a caption for every screenshot", () => {
    for (const [key, shot] of Object.entries(screenshots)) {
      expect(shot.alt.length, key).toBeGreaterThan(15);
      expect(shot.alt, key).not.toMatch(/\.(png|webp|jpe?g)$|^screenshot/i);
      expect(shot.caption.length, key).toBeGreaterThan(5);
      expect(shot.image, key).toBeTruthy();
    }
  });

  it("lists every image file of the directory, and only those", () => {
    const pngs = readdirSync(dir)
      .filter((f) => /\.(png|webp|jpe?g)$/.test(f))
      .map((f) => f.replace(/\.\w+$/, ""))
      .sort();
    expect(Object.keys(screenshots).sort()).toEqual(pngs);
  });

  it("says where every screenshot is meant to be used", () => {
    for (const [key, shot] of Object.entries(screenshots)) {
      expect(shot.use.length, key).toBeGreaterThan(0);
      for (const use of shot.use) expect(["landing", "docs"], key).toContain(use);
    }
  });

  it("recognizes phone scenes by their key", () => {
    expect(isPhone("chat-phone")).toBe(true);
    expect(isPhone("chat-desktop")).toBe(false);
  });
});
