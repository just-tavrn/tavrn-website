# tavrn website

The source of <https://tavrn.org>: the landing page, downloads, the documentation (wiki), the status page of the
official node, the roadmap and the legal pages of the tavrn project. It is a fully static site built with
[Astro](https://astro.build) and [Starlight](https://starlight.astro.build), served by Caddy from a small container.

> **Status: private review.** The site is being built before the project's first public release.

## What is where

| Path | What |
|---|---|
| `src/pages/` | The custom pages: landing (`index.astro`), `download`, `status`, `issues` (known issues), `report` (report a problem), `roadmap`, `legal/`, `404` |
| `src/components/` | Header, footer, `Brand` (the name with `translate="no"`), `Shot` (screenshot frames), the landing's interactive parts (`Federation`, `E2eeToggle`, `Showcase`); `download/` the download page's parts (`Releases`, which renders the releases at runtime, the OS cards and the checksum verifier), `status/` the status page's Preact island (`NodeStatus`, `UptimeHistory`, written against the React API through `preact/compat`) and the live dot of the "Status" link (`StatusDot`, vanilla JavaScript); `issues/` the known-issues page's Preact island (`KnownIssues`) |
| `src/content/docs/` | The wiki (Starlight), served under `/docs/`; its sidebar is `src/docs-sidebar.ts`. `users/` holds the hand-written user guides, `synced/` the pages generated from `sources/` (gitignored, see "The wiki and its sources") |
| `src/content/pages/` | Markdown pages outside the wiki (the roadmap, generated from `sources/tavrn`) |
| `sources/` | Git submodules of the repositories the wiki copies its operator and developer pages from |
| `src/i18n/` | UI strings of the custom pages (`en.json`), the `t()` / `rich()` helpers, the list of languages |
| `src/styles/` | `tokens.css` (the web client's design tokens), `global.css` (pages), `starlight.css` (docs) |
| `src/assets/screenshots/` | The screenshots and `manifest.ts` (scene key → image, alt text, caption) |
| `public/` | Favicons, app icons, `og.png` (rendered by `just og-image` from `scripts/og/template.html` and `src/assets/brand/og-background.png`), `site.webmanifest`, `robots.txt` |
| `src/assets/brand/` | Logo and wordmark, the Open Graph background and the hero background (two generated abstract images, CC-BY-4.0 like the texts) |
| `deploy/` | `Dockerfile`, `Caddyfile`, `entrypoint.sh`, `docker-compose.yml`, `.env.example`, [deployment notes](deploy/README.md) |
| `e2e/` | Playwright: every route, axe scans, keyboard, CSP, privacy |
| `tests/` | Vitest checks of the built site (JavaScript budget, CSP hashes, no foreign URLs) |
| `scripts/` | CSP hashes, SPDX and license checks, the publication check, the docs sync (`sync-docs.mjs`, `docs-sources.mjs`, `gen-env-reference.mjs`, `lib/`) |

## Running it

Requirements: Node.js 24, pnpm (the version in `package.json`, `corepack enable` provides it), [just](https://just.systems),
Docker for the image and the Caddyfile check.

```sh
git submodule update --init   # the docs sources under sources/ (a fresh clone has empty directories)
pnpm install
just dev          # http://localhost:4321, hot reload
just build        # dist/ and csp-script-hashes.txt
just preview      # serves dist/ on http://127.0.0.1:4400
just check        # everything below, must be green before a commit
```

`just check` runs the strict docs sync, `astro check`, the build, Vitest (unit tests, the checks of `dist/` and its link checker), the SPDX and license
checks, `scripts/publish-check.sh`, `caddy validate` on `deploy/Caddyfile` and the Playwright suite. The two Docker
tests of the Caddyfile (`just caddy-test`: the GitHub proxies under `/gh/`, the desktop update feeds and the legal pages' runtime values) run
separately. Playwright runs only Chromium and the Android phone emulation with two workers:

```sh
just e2e          # = playwright test -c e2e/playwright.config.ts --project chromium --project mobile-android --workers=2
```

The suite serves `dist/` with `astro preview` on port 4400 (`E2E_PORT` changes it), so build first. It needs the
Chromium of Playwright 1.63 (`pnpm exec playwright install chromium` if it is not cached).

## The wiki and its sources

The wiki has three groups: **Users** (written here, in `src/content/docs/users/`), **Node admins** and
**Developers**. The pages of the last two are not kept in this repository: they are copied at build time from the
repositories where they are versioned with the code, so they always match it.

| Submodule | What the wiki takes from it |
|---|---|
| `sources/tavrn` | `docs/self-hosting.md` (admin overview), `docs/architecture.md`, `docs/roadmap.md` (also `/roadmap`) |
| `sources/tavrn-node` | `docs/HANDBOOK.md`, split into one page per section, and `deploy/.env.example` (the configuration reference) |
| `sources/tavrn-protocol` | The specification: `README.md`, `PROTOCOL.md`, `FEDERATION.md`, `ENCRYPTION.md` and the other documents |
| `sources/tavrn-js` | The READMEs of `sdk/`, `e2ee/` and `bot/` |
| `sources/tavrn-web` | `docs/CLIENT.md`, `docs/DESKTOP.md`, `docs/ACCESSIBILITY.md` |

`scripts/sync-docs.mjs` does the copying (the list is `scripts/docs-sources.mjs`). It runs before every `pnpm dev`,
`pnpm build` and `pnpm typecheck`, and alone as `just sync-docs`. It writes `src/content/docs/synced/` and
`src/content/pages/roadmap.md` (both gitignored) and

- adds the Starlight frontmatter: the title from the first H1 (removed from the body), a description from the first
  paragraph (or the one configured), an edit link to the file in its **source** repository and the sidebar order;
- rewrites links: between synced files to site routes (also into the middle of the split handbook), to other files
  of the source repositories to GitHub; badges and GitHub-only blocks are dropped, GitHub alerts (`> [!NOTE]`) become
  asides, headings start at H2, every code block gets a language, task lists become plain lists;
- generates the configuration reference (`scripts/gen-env-reference.mjs`): one table per section of the node's
  `.env.example`, an anchor per variable (`/docs/admins/configuration-reference/#TAVRN_DOMAIN`);
- fails with a list of the missing files when a configured source is not there.

Links to an anchor that no longer exists (kept without the fragment), configured sections and replacements that no
longer match their source are warnings for `dev` and `build`, and errors for `node scripts/sync-docs.mjs --strict`
(`just sync-docs-strict`), which `just check` and the CI run.

**Diagrams.** ```` ```mermaid ```` blocks, synced or hand-written, become diagrams (`src/lib/mermaid.mjs`): the
page carries the source, and on pages that have a diagram a small loader imports Mermaid (bundled, lazy, no
requests elsewhere) and draws it in the site's colours (`src/lib/mermaid-render.ts`). Without JavaScript the
source shows like code; the source also stays in a "Diagram source" disclosure under every drawing.

A generated page names its source and license at the bottom. To change such a page, change the source repository.
To add a document, add it to `scripts/docs-sources.mjs`; the sidebar groups pick it up by directory
(`src/docs-sidebar.ts`).

**Updating the sources.** The submodules are pinned to a commit and track `main` until the first release tags:

```sh
just update-sources                  # = git submodule update --init --remote --merge sources/
just sync-docs-strict && just build  # check the result (an error names an anchor or section that moved)
git add sources && git commit -m "Update the docs sources"
```

Once the repositories publish release tags, pin each submodule to the tag of the release train instead
(`git -C sources/tavrn-node checkout v0.1.0 && git add sources/tavrn-node`). While the repositories are private,
fetching them needs a GitHub token with read access; the CI and image workflows still check out without
submodules and have to be switched to `submodules: true` with such a token before they can build the wiki.

## Screenshots

The screenshots in `src/assets/screenshots/` come from a reproducible pipeline in [`shots/`](shots/README.md): a
Playwright script drives the web client against a fresh local demo node with fictitious accounts. `shots/run.sh`
makes a new set; `node shots/import.mjs <out>` copies it into the site and regenerates
`src/assets/screenshots/manifest.ts` (scene key, alt text, caption) from the run's `manifest.json`. Pages use the
scene keys only; Astro makes the WebP variants and widths at build time (WebP only, no PNG fallback: every browser in
scope reads WebP).

## Downloads and status

**Download page.** The page reads the releases at runtime, so a new release of `tavrn-web` or `tavrn-node` shows
on it within five minutes, without a new build or image. The visitor's browser never contacts GitHub: a small
script (`src/components/download/Releases.astro`, plain JavaScript) asks this site's own server for
`/gh/releases/web` and `/gh/releases/node` (the 20 newest releases of each repository) and `/gh/repos/web` (whether
`tavrn-web` is private), which the container forwards to GitHub's API with its read-only token like `/gh/issues`
("Known issues and reporting"). Only these JSON lists pass through the server: the installers are plain links to
GitHub's asset URLs, and the website never proxies or caches a binary. `src/lib/releases.ts` holds the rules, as
pure functions with unit tests:

- Drafts are ignored, and so is every release without an installer (one with only the web bundle does not count).
- **Stable** is the newest release that is not a pre-release (by publication date), **Beta** the newest pre-release
  published after it, or the newest pre-release at all when there is no stable release. GitHub's pre-release flag
  marks the betas.

**Update feeds of the desktop apps.** The apps check for updates on this site, per channel:
`/updates/desktop/stable/…` and `/updates/desktop/beta/…` (`latest.json` for the Tauri app, `latest.yml` and
`latest-linux.yml` with their `.minisig` for the Electron shell). Each is a redirect to that file on GitHub's release
downloads, of the highest stable version, or for beta the highest version including pre-releases, that carries the
file; the container only chooses the release (`deploy/update-feeds.sh`, refreshed every five minutes) and never
serves a feed itself. Details in [deploy/README.md](deploy/README.md#desktop-update-feeds).
- Both: two tabs above the OS cards, "Stable <version>" (selected) and "Beta <version>" (WAI-ARIA tabs, arrow keys,
  Home and End). The tab swaps the whole card set, the release line under the title, the verify details and the
  verifier's known checksums; the beta panel starts with a sentence on what a beta is and its cards carry a "Beta"
  badge. `/download#beta` opens the beta tab; nothing is remembered.
- Stable only: no tabs. Beta only: no tabs, the "Beta" badge, the sentence and a line that there is no stable
  release yet.
- Neither, or 401/403/404 from the proxy (no token, a token without access): "There is no release yet" and a link
  to the releases on GitHub, no buttons; server and network errors add "The release list could not be loaded".
- While `tavrn-web` is a private repository, visitors could not download the assets (GitHub asks them to sign in):
  the cards list the files without download links, with a sentence why and the link to GitHub. The self-host card
  says the same about the node image.
- The self-host card names the image of the newest stable `tavrn-node` release
  (`ghcr.io/<org>/tavrn-node:<version>`), else of its newest pre-release (marked), else `:edge` with a note.

The classifier sorts the release assets by format (NSIS `.exe` and `.msi`, AppImage, `.deb`, `.dmg`, `.app.tar.gz`,
`.apk`), architecture (from the file name; an AppImage without one is x64, as electron-builder names it) and
desktop shell, takes the SHA-256 from GitHub's asset `digest` (`sha256:<hex>`) and attaches the Tauri updater
`.sig`. The update feeds (`latest.json`, `latest.yml`, `latest-linux.yml`), the web bundle and anything else are not
downloads. The cards are static shells (`OsCard.astro`, `Verify.astro`) with `<template>`s the script fills, and they
keep their height while the lists load, so the page does not jump. A small script moves the card of the visitor's
operating system to the front (`src/lib/os.ts`, from the user agent and client hints only). Without JavaScript the
page shows a note with the link to the releases on GitHub; the web app and self-host cards stay.

The shells follow tavrn-web's `docs/DESKTOP.md`: **Linux** is the Electron app (electron-builder:
`Tavrn-<version>.AppImage` and `tavrn_<version>_amd64.deb`, no `.rpm`); **Windows** is the Tauri app
(`Tavrn_<version>_x64-setup.exe`, `.msi`) with an optional **Electron build for Windows** for computers where WebView2 makes trouble, shown on the Windows card as a
small secondary "Alternative build" disclosure. The classifier tells the two Windows builds apart by name only, so
**the Electron Windows artifact must contain `electron` in its file name**, for example
`tavrn-electron_<version>_x64-setup.exe` (electron-builder's default `Tavrn Setup <version>.exe` would be ignored).
Every Linux package counts as Electron, every other file without `electron` in its name as Tauri.

**Checking a download.** Below the cards, a verifier (`src/components/download/Verifier.astro`, plain JavaScript,
pure helpers in `src/lib/verify.ts`) checks a chosen or dropped file on the visitor's device: SHA-256 with
`crypto.subtle` (and SHA-512 for a pasted one, such as a value from `latest-linux.yml`). It compares the result with
the SHA-256 digests of the release the page shows (written into the verifier at runtime, following the selected
tab) and with an optional pasted value (hex or base64, whitespace tolerated). Nothing is uploaded, files above 1 GB
are refused with a pointer to the command line check. The end-to-end tests mock the three proxies with releases
named like `v0.3.0-rc.1` (`e2e/fixtures/gh-releases.ts`) whose installer and AppImage digests are the SHA-256 of
`e2e/fixtures/example-installer.bin` and `example-appimage.bin`, so `e2e/verify.spec.ts` covers the match.

**Status page and the live dot.** The status page is a Preact island (`client:load`, only on `/status`, under 60 KB
of JavaScript gzipped with the runtime): it reads `/config.json`, then asks the node for `/healthz`, `/readyz` and
`/api/v1/node` on load, every 60 seconds and on "Refresh now" (8-second timeouts), and shows Operational, Degraded or
Unreachable with the reasons. With `UPTIME_KUMA_URL` and `UPTIME_KUMA_PAGE` set it adds the uptime history (24-hour
uptime, the last 90 checks, active incidents) from Uptime Kuma's public status-page API, which the container forwards
as `/uptime/api/status-page/…` (`src/lib/kuma.ts` describes the shapes). The "Status" link of the header, the mobile
menu and the docs header carries a live dot (`src/components/status/StatusDot.astro`, plain JavaScript): one
`/healthz` request per page view when the browser is idle, the state as visually hidden text ("Status: online"), and
an invisible dot of reserved width while the state is unknown or without JavaScript, so nothing shifts.
The end-to-end tests mock `/config.json`, the node and Kuma (`e2e/mocks.ts`), so they never leave the machine.

## Known issues and reporting

**Known issues (`/issues`).** A Preact island (`client:load`, under 60 KB of JavaScript gzipped like the status page)
lists the open issues of the organization's repositories: search (title, labels, repository, number), filter chips
for repositories and labels, grouped by repository or ordered by the last update, with a "Search on GitHub" link
that carries the search text. The browser never contacts GitHub: it reads `/gh/issues` from this site, and the
container forwards exactly that one request to GitHub's issue search (`org:<GITHUB_ORG> is:issue is:open`, the 100
most recently updated) with a read-only token (`GITHUB_READ_TOKEN`), without any header or query parameter of the
visitor, and answers with the JSON body only, cacheable for five minutes (`deploy/Caddyfile`; `just gh-proxy-test`
checks it in Docker against a fake GitHub). Without a token `/gh/issues` is 404 and the page links to GitHub
instead. `src/lib/issues.ts` is the model (parsing, grouping, filtering, relative dates); the end-to-end tests mock
`/gh/issues` with `e2e/fixtures/gh-issues.json`.

**Report a problem (`/report`).** A static page: a short checklist (known issues first, latest version, one problem
per report, nothing private, reports are public, a GitHub account is needed), one button to the umbrella
repository's issue chooser (`https://github.com/<org>/tavrn/issues/new/choose`, which asks what the problem is
about and opens the form of the right repository), where to find the version and the logs, and a separate card for
security problems that points to private vulnerability reporting per repository (the organization's
`SECURITY.md`), never to a public issue.

## Configuration

Two groups of values: those written into the pages at **build time**, and those the container reads at **runtime**.

### Build time (`astro:env`, public)

Set them as environment variables for `pnpm build`, or as `--build-arg` of the image. Their defaults are the
official site's, so the image CI builds needs none and is generic: nothing operator-specific or personal is baked
in.

| Variable | Default | Used for |
|---|---|---|
| `PUBLIC_SITE_URL` | `https://tavrn.org` | Canonical URLs, Open Graph, sitemap |
| `PUBLIC_GITHUB_ORG` | `just-tavrn` | Links to GitHub (repositories, discussions, security policy) |

### Runtime (container environment)

| Variable | Default | Used for |
|---|---|---|
| `TAVRN_APP_URL` | `https://app.tavrn.org` | `/app` ("Open the web app") redirects here |
| `TAVRN_NODE_URL` | `https://app.tavrn.org` | The node the status page (`/healthz`, `/readyz`, `/api/v1/node`) and the live dot of the "Status" link (`/healthz`) ask from the visitor's browser; allowed in the CSP's `connect-src` |
| `TAVRN_NODE_WS_URL` | derived from `TAVRN_NODE_URL` | WebSocket endpoint in the delegation document |
| `TAVRN_NODE_DOMAIN` | `tavrn.org` | Identity domain in the delegation document |
| `TAVRN_WELLKNOWN` | `off` | `/.well-known/tavrn`: `off` (404), `on` (static document from these variables), `proxy` (the node's own document) |
| `TAVRN_ANDROID_CERT_SHA256` | empty | `/.well-known/assetlinks.json` for the Android app `org.tavrn.app`: the SHA-256 fingerprint of its release certificate (`AA:BB:…`); empty: 404 (deploy/README.md "Android app") |
| `UPTIME_KUMA_URL` | empty | Uptime Kuma base URL as the container reaches it (for example `http://uptime-kuma:3001`); the container proxies the status page's two API endpoints as `/uptime/api/status-page/…`, because Kuma sends no CORS headers |
| `UPTIME_KUMA_PAGE` | empty | Slug of Uptime Kuma's public status page |
| `GITHUB_READ_TOKEN` | empty | Read-only GitHub token (Issues and Contents: read-only) for the known-issues page, the download page and the desktop update feeds: the container forwards `GET /gh/issues` (the issue search), `GET /gh/releases/web`, `GET /gh/releases/node` (the release lists) and `GET /gh/repos/web` (whether `tavrn-web` is private) to GitHub's API with it, without anything from the visitor, and reads the release list for `/updates/desktop/…` every five minutes; empty: `/gh/*` is 404, the known-issues page links to GitHub, the download page says there is no release yet and the update feeds answer 503 |
| `GITHUB_ORG` | `just-tavrn` | The organization of the issues and of the `tavrn-web` and `tavrn-node` repositories behind `/gh/` (keep it equal to `PUBLIC_GITHUB_ORG`, which also names the node image) |
| `TAVRN_IMPRINT_NAME` | `Name of the provider` | Provider in the imprint and GDPR controller in the privacy policy (personal data: set it in the stack, never in the repository) |
| `TAVRN_IMPRINT_STREET` | `Street and number` | Provider's street |
| `TAVRN_IMPRINT_CITY` | `Postal code and city` | Provider's postal code and city |
| `TAVRN_IMPRINT_COUNTRY` | `Germany` | Provider's country |
| `TAVRN_CONTACT_EMAIL` | `hello@tavrn.org` | Contact address in the imprint and the privacy policy (a plain address; anything else falls back to the default) |

The defaults point at the current test node until the official node moves to its own host. The container serves
these values as `GET /config.json` (`appUrl`, `nodeUrl`, `nodeDomain`, `uptimeKumaUrl`, `uptimeKumaPage`), so the
status page and the live dot read them at runtime. The imprint and the privacy policy are the only templates: they
are built with Go template actions (`{{env "TAVRN_IMPRINT_NAME"}}`, …; `src/lib/runtime-env.ts`) that Caddy's
`templates` handler replaces with these values at request time, the privacy policy also naming the host of
`TAVRN_NODE_URL`. `deploy/entrypoint.sh` strips line breaks and HTML-escapes the values first and logs a warning
while the imprint placeholders are in use; `just legal-templates-test` checks the rendering in Docker. Without Caddy
(`pnpm dev`, `pnpm preview`) the pages show the actions as they are. Each variable is explained in
[`deploy/.env.example`](deploy/.env.example).

## The container image

```sh
just docker-build                       # docker build -f deploy/Dockerfile -t tavrn-website:dev .
docker run --rm -p 18080:8080 -e TAVRN_WELLKNOWN=on tavrn-website:dev
```

The image is `caddy:2-alpine` with the build at `/srv`, running unprivileged on port 8080 (TLS ends at the reverse
proxy). Caddy sets the security headers (a strict Content-Security-Policy with `script-src 'self'` plus the hashes
of the few inline scripts Starlight renders, HSTS, `Referrer-Policy: no-referrer`, …), caches `/_astro/` for a year
and HTML never, serves the custom 404 page, and logs requests **without** IP addresses or user agents.
[`deploy/README.md`](deploy/README.md) describes the Portainer stack, Nginx Proxy Manager and Cloudflare.

## Adding a language

English lives at the root, every other language under `/<code>/` (for German: `/de/`).

1. Add the code to `localeCodes` (and its name to `localeLabels`) in `src/i18n/locales.ts`; Astro's i18n routing
   and Starlight both take the list from there.
2. Copy `src/i18n/en.json` to `src/i18n/de.json`, translate the values (keep the keys and the `{placeholders}`;
   `{brand}` stays as it is), and register it in `MESSAGES` in `src/i18n/index.ts`. The unit test fails until both
   files have the same keys.
3. Put the translated docs under `src/content/docs/de/` with the same file names (untranslated pages fall back to
   English, marked as such) and, optionally, Starlight's own UI strings in `src/content/i18n/de.json`.
4. Add the pages under `src/pages/de/` (they reuse the components; `Astro.currentLocale` selects the strings). The
   legal pages are written per language.

`hreflang` links, `<html lang>` and the language-aware links (`localePath()`) follow automatically.

## Rules for the content

- Plain English for ordinary users; the product name is always lowercase "tavrn". In UI strings it is written as
  `{brand}` and rendered with `translate="no"`; in Markdown a rehype plugin does the same.
- Honest claims only (what the project's README and FAQ say); no comparisons with other products by name.
- No external requests except the status check: no CDNs, fonts, analytics or embeds. The only connection to another
  origin is the visitor's browser asking the official node (`TAVRN_NODE_URL`) for its health, from the live dot of
  the "Status" link and the status page; the privacy policy says so. The known-issues list and the release lists come
  from GitHub through this site's own server (`/gh/…`), not from the browser; downloads are ordinary links to GitHub,
  and the desktop apps' update feeds (`/updates/desktop/…`) redirect to GitHub. No cookies and no browser storage. The tests enforce all of it.
- WCAG 2.2 AA: visible focus, 44 px targets on touch, contrast from the tokens only, headings in order, alt texts,
  reduced motion respected, everything works with the keyboard.
- The landing page stays under 50 KB of JavaScript (gzipped), without an island framework; the status and known-issues
  pages, the only pages with Preact, stay under 60 KB each, the download page (plain JavaScript) under 15 KB.
  `tests/dist.test.ts` measures them.

## License and trademark

The code is licensed under [Apache-2.0](LICENSE-APACHE), the texts and screenshots under
[CC-BY-4.0](LICENSE-CC-BY-4.0); [LICENSE.md](LICENSE.md) has the details and the attribution we ask for. The name
"tavrn", the logo and the icons are not covered by these licenses; see the [trademark policy](TRADEMARK.md).
Contributions are accepted under the [contributor license agreement](CLA.md).

## Builds and documentation changes

`ci.yml` and `image.yml` use `scripts/ci-changes.sh` to skip application checks and container builds for
repository administration only (root contribution/brand/readme documents, `docs/`, issue templates and the
CLA, secret-scan and dependency-review workflows). CLA, secret scans, publication hygiene and the lightweight
change-filter/SPDX check still run. Unknown paths, application code, dependencies, deployment files and the
CI/image workflows trigger checks and builds. Manual runs and release tags always build.

Website pages and wiki content under `src/`, including Markdown and MDX, always trigger builds, as do changes
to `sources/`, `.gitmodules` and the docs-sync scripts. Upstream repository docs reach the website through
its pinned source submodules: merge their updates here to rebuild the imported documentation. Root repository
README/CLA/brand texts are not the website wiki. The privacy-page change in this branch therefore correctly
runs the website build and browser checks; the CLA workflow alone would not.
