// SPDX-License-Identifier: Apache-2.0
import { DEFAULT_LOCALE, localeCodes } from "../i18n/locales.ts";

/**
 * Starlight serves its collection from the site root; the wiki belongs under /docs. The ids get a "docs/" segment
 * after the locale: src/content/docs/users/x.md -> docs/users/x (/docs/users/x), src/content/docs/de/users/x.md ->
 * de/docs/users/x (/de/docs/users/x), so Starlight still finds the locale in the first segment. A `slug` in the
 * frontmatter is used as it is.
 */
export function docsId(entry: string, slug?: unknown): string {
  if (typeof slug === "string" && slug.length > 0) return slug;
  const segments = entry
    .replace(/\.(mdx?|markdown|mdoc)$/i, "")
    .split("/")
    .map((s) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter(Boolean);
  if (segments.at(-1) === "index") segments.pop();
  const first = segments[0];
  if (first && first !== DEFAULT_LOCALE && (localeCodes as readonly string[]).includes(first)) {
    return [first, "docs", ...segments.slice(1)].join("/");
  }
  return ["docs", ...segments].join("/");
}
