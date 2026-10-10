// SPDX-License-Identifier: Apache-2.0
/**
 * The languages of the site. English lives at the root, every other language under /<code>/. Adding a language
 * (README.md, "Adding a language"): add its code here, its strings as src/i18n/<code>.json (registered in
 * src/i18n/index.ts) and its docs under src/content/docs/<code>/.
 */
export const DEFAULT_LOCALE = "en";
export const localeCodes = ["en"] as const;
export type Locale = (typeof localeCodes)[number];

/** Human names of the languages, in the language itself (for the language switch). */
export const localeLabels: Record<Locale, string> = {
  en: "English",
};
