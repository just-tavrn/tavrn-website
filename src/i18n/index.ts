// SPDX-License-Identifier: Apache-2.0
/**
 * UI strings of the custom pages: flat JSON per language (same convention as the web client), `{name}`
 * placeholders, English as the fallback. `{brand}` stands for the product name: t() writes it as plain text,
 * rich() as <span translate="no">tavrn</span> so machine translation leaves it alone.
 * New language: src/i18n/<code>.json, one entry in MESSAGES below and the code in ./locales.ts.
 */
import en from "./en.json";
import { DEFAULT_LOCALE, localeCodes, localeLabels, type Locale } from "./locales";

export { DEFAULT_LOCALE, localeCodes, localeLabels, type Locale };
export type Messages = Record<string, string>;

export const MESSAGES: Record<Locale, Messages> = {
  en,
};

export const BRAND = "tavrn";
export const BRAND_HTML = `<span translate="no">${BRAND}</span>`;

/** The locale for Astro.currentLocale (undefined outside localized routes) or any string. */
export function resolveLocale(locale: string | undefined): Locale {
  return (localeCodes as readonly string[]).includes(locale ?? "") ? (locale as Locale) : DEFAULT_LOCALE;
}

function template(locale: string | undefined, key: string): string {
  const template = MESSAGES[resolveLocale(locale)][key] ?? MESSAGES[DEFAULT_LOCALE][key];
  if (template === undefined) throw new Error(`missing UI string "${key}"`);
  return template;
}

type Params = Record<string, string | number>;

function fill(text: string, params: Params | undefined, brand: string, escape: (s: string) => string): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (name === "brand") return brand;
    const value = params?.[name];
    return value === undefined ? whole : escape(String(value));
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** A UI string as plain text (attributes, titles, meta tags). */
export function t(locale: string | undefined, key: string, params?: Params): string {
  return fill(template(locale, key), params, BRAND, (s) => s);
}

/**
 * A UI string as HTML for `set:html`: the template is escaped, {brand} becomes the translate="no" span, and
 * parameters are escaped unless their name ends in "Html" (for links built by the page itself).
 */
export function rich(locale: string | undefined, key: string, params?: Params): string {
  const escaped = escapeHtml(template(locale, key));
  return escaped.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (name === "brand") return BRAND_HTML;
    const value = params?.[name];
    if (value === undefined) return whole;
    return name.endsWith("Html") ? String(value) : escapeHtml(String(value));
  });
}

/** A path of the site in the given locale: "/download" -> "/download" (en), "/de/download" (de). */
export function localePath(locale: string | undefined, path: string): string {
  const l = resolveLocale(locale);
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (l === DEFAULT_LOCALE) return clean;
  return clean === "/" ? `/${l}/` : `/${l}${clean}`;
}

/** The path without its locale prefix: "/de/download" -> "/download". */
export function unlocalizedPath(path: string): string {
  for (const l of localeCodes as readonly string[]) {
    if (l === DEFAULT_LOCALE) continue;
    if (path === `/${l}` || path === `/${l}/`) return "/";
    if (path.startsWith(`/${l}/`)) return path.slice(l.length + 1);
  }
  return path;
}

/** hreflang alternates of a page in every language, plus x-default (the English page). */
export function alternates(path: string, site: URL | string): { hreflang: string; href: string }[] {
  const base = unlocalizedPath(path);
  const links = localeCodes.map((l) => ({ hreflang: l, href: new URL(localePath(l, base), site).href }));
  return [...links, { hreflang: "x-default", href: new URL(localePath(DEFAULT_LOCALE, base), site).href }];
}

