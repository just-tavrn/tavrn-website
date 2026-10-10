// SPDX-License-Identifier: Apache-2.0
/**
 * The sidebar of /docs (Starlight), one group per audience. Imported by astro.config.mjs; the wiki is maintained
 * here and under src/content/docs/ without touching the Astro configuration. Entry ids carry the "docs/" prefix
 * (src/content.config.ts), so a page at src/content/docs/users/x.md has the slug "docs/users/x".
 *
 * The groups list their pages by directory, sorted by each page's `sidebar.order`. Starlight's `autogenerate`
 * matches the file's directory under src/content/docs/ (not the slug): `users` holds the hand-written user guides,
 * `synced/…` the pages that scripts/sync-docs.mjs generates from the submodules under sources/ (their file path
 * follows their slug, docs/admins/x -> synced/admins/x.md; order and labels are set in scripts/docs-sources.mjs).
 * A new section of the operator handbook therefore shows up without a change here. The groups start collapsed;
 * Starlight opens the one that holds the current page.
 */
import type { StarlightUserConfig } from "@astrojs/starlight/types";

export const docsSidebar: NonNullable<StarlightUserConfig["sidebar"]> = [
  { slug: "docs", label: "Overview" },
  {
    label: "Users",
    collapsed: true,
    items: [{ autogenerate: { directory: "users" } }],
  },
  {
    label: "Node admins",
    collapsed: true,
    items: [{ autogenerate: { directory: "synced/admins" } }],
  },
  {
    label: "Developers",
    collapsed: true,
    items: [
      { slug: "docs/developers/overview" },
      { slug: "docs/developers/architecture" },
      { label: "Protocol", collapsed: true, items: [{ autogenerate: { directory: "synced/developers/protocol" } }] },
      { label: "SDK and bots", collapsed: true, items: [{ autogenerate: { directory: "synced/developers/sdk" } }] },
      { label: "Web client and desktop", collapsed: true, items: [{ autogenerate: { directory: "synced/developers/web" } }] },
      { slug: "docs/developers/contributing" },
      { slug: "docs/developers/roadmap" },
    ],
  },
];
