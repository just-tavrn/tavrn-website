// SPDX-License-Identifier: Apache-2.0
// The tavrn website: fully static output (Caddy serves dist/, deploy/), Starlight for /docs, Preact (with its React
// compatibility layer) for the status page's island, Tailwind v4 with the web client's design tokens.
import preact from "@astrojs/preact";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { unified } from "@astrojs/markdown-remark";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, envField } from "astro/config";
import { docsSidebar } from "./src/docs-sidebar.ts";
import { DEFAULT_LOCALE, localeCodes } from "./src/i18n/locales.ts";
import rehypeBrand from "./src/lib/rehype-brand.mjs";
import remarkMermaid from "./src/lib/mermaid.mjs";

const GITHUB_ORG = process.env.PUBLIC_GITHUB_ORG || "just-tavrn";

/**
 * Starlight remembers the open sidebar groups in sessionStorage. The site stores nothing in the browser (privacy
 * policy), so that module becomes empty; the Sidebar override (src/components/starlight/Sidebar.astro) drops the
 * matching restore script.
 */
function noSidebarStorage() {
  return {
    name: "tavrn:no-sidebar-storage",
    enforce: "pre",
    load(id) {
      if (/components-internals[\\/]SidebarPersistState\.[jt]s$/.test(id.split("?")[0])) return "export {};";
    },
  };
}

/**
 * Mermaid ships the ELK layout engine (elkjs, EPL-2.0, 440 KB gzipped) as a lazy chunk. The docs draw with dagre
 * (src/lib/mermaid-render.ts), so the chunk becomes a stub: elkjs never enters the build, and a diagram that asks
 * for an ELK layout shows its source instead.
 */
function noElkLayout() {
  return {
    name: "tavrn:no-elk-layout",
    enforce: "pre",
    load(id) {
      if (/mermaid[\\/]dist[\\/]chunks[\\/]mermaid\.core[\\/]elk-[\w-]+\.mjs$/.test(id.split("?")[0])) {
        return 'export const render = () => { throw new Error("The ELK layout is not part of this site"); };';
      }
    },
  };
}

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || "https://tavrn.org",
  output: "static",
  trailingSlash: "ignore",
  build: {
    // /download -> dist/download/index.html; Caddy's try_files serves the clean URL (deploy/Caddyfile).
    format: "directory",
  },
  // English at the root, every further language under /<code>/ (README.md, "Adding a language"). Starlight takes
  // its locales from here (it refuses a second, own locale configuration).
  i18n: {
    defaultLocale: DEFAULT_LOCALE,
    locales: [...localeCodes],
    routing: { prefixDefaultLocale: false },
  },
  // Build-time values for the prerendered text (README.md, "Configuration"). The runtime values of the container
  // (node URL, app URL, Uptime Kuma) are served by Caddy as /config.json; the imprint and contact details are filled
  // into the two legal pages by Caddy at request time (src/lib/runtime-env.ts).
  env: {
    schema: {
      PUBLIC_SITE_URL: envField.string({ context: "client", access: "public", default: "https://tavrn.org" }),
      PUBLIC_GITHUB_ORG: envField.string({ context: "client", access: "public", default: "just-tavrn" }),
    },
  },
  markdown: {
    // "tavrn" keeps translate="no" in Markdown too, and so do code blocks (machine translation leaves them alone).
    // ```mermaid fences become diagrams (src/lib/mermaid.mjs), drawn in the browser on the pages that have one.
    processor: unified({ remarkPlugins: [remarkMermaid], rehypePlugins: [rehypeBrand] }),
  },
  integrations: [
    starlight({
      title: "tavrn docs",
      description: "Guides for people who use tavrn, run a node or build on it.",
      logo: { src: "./src/assets/brand/icon-192.png", alt: "" },
      favicon: "/favicon.ico",
      // The landing has its own 404 page (src/pages/404.astro).
      disable404Route: true,
      editLink: { baseUrl: `https://github.com/${GITHUB_ORG}/tavrn-website/edit/main/` },
      sidebar: docsSidebar,
      customCss: ["./src/styles/starlight.css"],
      components: {
        // Dark only: no theme switch, no theme script (data-theme="dark" is Starlight's server default).
        ThemeProvider: "./src/components/starlight/ThemeProvider.astro",
        ThemeSelect: "./src/components/starlight/ThemeSelect.astro",
        SiteTitle: "./src/components/starlight/SiteTitle.astro",
        SocialIcons: "./src/components/starlight/SocialIcons.astro",
        Sidebar: "./src/components/starlight/Sidebar.astro",
        // Loads Mermaid only on pages with a diagram (src/lib/mermaid-render.ts).
        MarkdownContent: "./src/components/starlight/MarkdownContent.astro",
      },
      head: [
        { tag: "meta", attrs: { name: "color-scheme", content: "dark" } },
        { tag: "link", attrs: { rel: "icon", href: "/favicon-32.png", type: "image/png", sizes: "32x32" } },
        { tag: "link", attrs: { rel: "apple-touch-icon", href: "/apple-touch-icon.png" } },
        { tag: "link", attrs: { rel: "manifest", href: "/site.webmanifest" } },
      ],
    }),
    // Preact with the React compatibility layer: the status island is written against the React API (hooks from
    // "react") but ships Preact's runtime, a tenth of react-dom's size.
    preact({ compat: true }),
    sitemap(),
  ],
  vite: {
    plugins: [tailwindcss(), noSidebarStorage(), noElkLayout()],
    build: {
      // Scripts and small assets become files instead of inline code, so the Content-Security-Policy can stay
      // script-src 'self' (deploy/Caddyfile).
      assetsInlineLimit: 0,
    },
  },
});
