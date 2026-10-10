// SPDX-License-Identifier: Apache-2.0
import { docsLoader, i18nLoader } from "@astrojs/starlight/loaders";
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { docsId } from "./lib/docs-id.ts";

export const collections = {
  docs: defineCollection({
    loader: docsLoader({ generateId: ({ entry, data }) => docsId(entry, data.slug) }),
    schema: docsSchema(),
  }),
  // Starlight's own UI strings per language (src/content/i18n/<code>.json), for the docs only.
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
  // Markdown pages outside the wiki (the roadmap, generated from the umbrella repository by scripts/sync-docs.mjs).
  pages: defineCollection({
    loader: glob({ base: "./src/content/pages", pattern: "**/*.md" }),
    schema: z.object({
      title: z.string(),
      description: z.string(),
    }),
  }),
};
