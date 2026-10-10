// SPDX-License-Identifier: Apache-2.0
/**
 * Values of the two legal pages (/legal/imprint/, /legal/privacy/) that the container fills in at request time, so
 * the image is generic and holds no personal data: the operator sets them in the stack (deploy/.env.example).
 *
 * The pages are built with literal Go template actions, `{{env "TAVRN_IMPRINT_NAME"}}` and so on, which Caddy's
 * `templates` directive executes for exactly these two pages (deploy/Caddyfile, `@legal`). Caddy uses Go's
 * text/template, which does not escape, so deploy/entrypoint.sh normalises the values and escapes them for HTML
 * (`& < > " '`) before Caddy starts. The pages insert the actions with `set:html` (Astro would escape the quotes)
 * and only into element text or a single-quoted attribute. Nothing else in these pages may contain `{{`;
 * tests/dist.test.ts checks that, and deploy/test/legal-templates.sh checks the rendering in Docker.
 *
 * Without Caddy (`pnpm dev`, `pnpm preview`, the end-to-end tests) the pages show the actions as they are.
 */
export const RUNTIME_VARS = [
  "TAVRN_IMPRINT_NAME",
  "TAVRN_IMPRINT_STREET",
  "TAVRN_IMPRINT_CITY",
  "TAVRN_IMPRINT_COUNTRY",
  "TAVRN_CONTACT_EMAIL",
  // Host part of TAVRN_NODE_URL, derived by deploy/entrypoint.sh.
  "TAVRN_NODE_HOST",
] as const;

export type RuntimeVar = (typeof RUNTIME_VARS)[number];

/** The Caddy template action that becomes the (HTML-escaped) value of `name`; insert it with `set:html`. */
export function runtimeEnv(name: RuntimeVar): string {
  return `{{env "${name}"}}`;
}

/** A mailto link to the contact address, as raw HTML for `set:html` (single-quoted href: the action has quotes). */
export function contactLinkHtml(attrs = ""): string {
  const email = runtimeEnv("TAVRN_CONTACT_EMAIL");
  return `<a href='mailto:${email}'${attrs ? ` ${attrs}` : ""}>${email}</a>`;
}
