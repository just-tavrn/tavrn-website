// SPDX-License-Identifier: Apache-2.0
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { alternates, localeCodes, localePath, MESSAGES, rich, t, unlocalizedPath } from "./index";

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Record<string, string>;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("locale files", () => {
  const en = load("en.json");

  it("every locale file has exactly the keys of en.json", () => {
    for (const f of files) expect(Object.keys(load(f)).sort(), f).toEqual(Object.keys(en).sort());
  });

  it("every locale file is registered, and every registered locale has a file", () => {
    expect(files.map((f) => f.replace(/\.json$/, "")).sort()).toEqual([...localeCodes].sort());
    expect(Object.keys(MESSAGES).sort()).toEqual([...localeCodes].sort());
  });

  it("translations keep the placeholders of the English strings", () => {
    for (const f of files) {
      const messages = load(f);
      for (const [key, value] of Object.entries(en)) {
        expect(placeholders(messages[key] ?? ""), `${f}: ${key}`).toEqual(placeholders(value));
      }
    }
  });

  it("no string writes the product name with a capital letter or outside {brand}", () => {
    for (const f of files) {
      for (const [key, value] of Object.entries(load(f))) {
        expect(value, `${f}: ${key}`).not.toMatch(/\bTavrn\b|\bTAVRN\b/);
      }
    }
  });
});

describe("t and rich", () => {
  it("fills placeholders and writes the brand as text", () => {
    expect(t("en", "hero.status")).toMatch(/^tavrn is in private review/);
  });

  it("falls back to English for unknown locales and throws on unknown keys", () => {
    expect(t("xx", "nav.docs")).toBe("Docs");
    expect(() => t("en", "does.not.exist")).toThrow(/missing UI string/);
  });

  it("rich() escapes the text and marks the brand translate=no", () => {
    const html = rich("en", "hero.status");
    expect(html).toContain('<span translate="no">tavrn</span>');
    expect(rich("en", "footer.license", { sourceHtml: "<a>x</a>" })).toContain("<a>x</a>");
  });
});

describe("paths", () => {
  it("keeps English at the root", () => {
    expect(localePath("en", "/download")).toBe("/download");
    expect(localePath(undefined, "/")).toBe("/");
    expect(unlocalizedPath("/download/")).toBe("/download/");
  });

  it("lists every locale plus x-default as alternates", () => {
    const links = alternates("/download/", "https://tavrn.org");
    expect(links.map((l) => l.hreflang)).toEqual([...localeCodes, "x-default"]);
    expect(links.at(-1)?.href).toBe("https://tavrn.org/download/");
  });
});
