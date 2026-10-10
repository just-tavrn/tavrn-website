# Deploying the website

The image serves the static build with Caddy on plain HTTP port 8080. TLS ends in front of it: Cloudflare at the
edge, then Nginx Proxy Manager (NPM) on the host, then this container on the Docker network.

```
Browser ──HTTPS──> Cloudflare (proxy, cache) ──HTTPS──> Nginx Proxy Manager ──HTTP──> website:8080 (Caddy)
```

## Files

| File | What |
|---|---|
| `Dockerfile` | Multi-stage build: `pnpm build` on `node:24-alpine`, then `caddy:2-alpine` with `dist/` at `/srv`, unprivileged |
| `Caddyfile` | Headers (CSP, HSTS, …), cache rules, clean URLs, 404 page, `/app`, `/config.json`, `/.well-known/tavrn`, the `/uptime/` and `/gh/issues` proxies, IP-free access log |
| `entrypoint.sh` | Normalizes the URLs, derives `TAVRN_NODE_WS_URL` and `TAVRN_NODE_HOST`, checks `GITHUB_ORG` and `GITHUB_READ_TOKEN`, HTML-escapes the imprint and contact details, then starts Caddy |
| `test/gh-proxy.sh` | Checks the `/gh/issues` proxy in Docker against a fake GitHub API (`just gh-proxy-test`) |
| `test/legal-templates.sh` | Checks in Docker that the legal pages show the imprint and contact details of the environment, escaped, and that no other page is a template (`just legal-templates-test`) |
| `docker-compose.yml` | The stack for Portainer: the `website` service and an optional, commented Uptime Kuma |
| `.env.example` | Every runtime variable with its default and meaning |

## Build and publish

```sh
docker build -f deploy/Dockerfile -t ghcr.io/just-tavrn/tavrn-website:latest .
docker push ghcr.io/just-tavrn/tavrn-website:latest
```

The image is generic: the two build arguments `PUBLIC_SITE_URL` and `PUBLIC_GITHUB_ORG` default to the official
site's values (README.md, "Configuration"), and everything else, including the imprint and the contact address,
is read from `.env.example`'s variables when the container starts. The CI workflow `.github/workflows/image.yml`
builds the same image as `ghcr.io/just-tavrn/tavrn-website` on `main` and on `v*` tags.

## Portainer stack

1. Create the stack from `docker-compose.yml`, with the variables of `.env.example` as stack environment.
2. Set the imprint: `TAVRN_IMPRINT_NAME`, `TAVRN_IMPRINT_STREET`, `TAVRN_IMPRINT_CITY`, `TAVRN_IMPRINT_COUNTRY`
   and `TAVRN_CONTACT_EMAIL` (personal data: only in the stack's environment, never in a repository). Caddy fills
   them into `/legal/imprint/` and `/legal/privacy/` on every request (the `templates` handler for exactly these two
   pages), so a change needs only a restart of the container, no new image. Until the first three are set, the
   pages show visible placeholders and the container logs a warning at start.
3. Attach it to the Docker network NPM uses (the compose file expects an external network named `proxy`; rename it
   to yours). No port is published: NPM reaches the container as `website:8080`.
4. Optional: uncomment `uptime-kuma`, create a public status page in it, and set `UPTIME_KUMA_URL`
   (`http://uptime-kuma:3001`) and `UPTIME_KUMA_PAGE` (the page's slug). The status page then shows the uptime
   history. The browser never talks to Kuma: the website container forwards exactly the two read-only API endpoints
   of that page (`/uptime/api/status-page/<slug>` and `…/heartbeat/<slug>`) without the visitor's IP address, user
   agent or cookies, because Kuma sends no CORS headers outside its development mode. Kuma needs a proxy host in NPM
   only if its own page should be public; with an `https://` URL in `UPTIME_KUMA_URL` the status page links to it.
5. Optional: set `GITHUB_READ_TOKEN` for the known-issues page (`/issues`). Create a **fine-grained personal access
   token** (resource owner: the organization; repository access: all repositories; permissions: **Issues:
   read-only**, Metadata: read-only comes with it) or use a GitHub App installation token with the same read-only
   permission. Nothing else. The token also makes the issues of **private** repositories visible on the public page,
   which is intended while the project is in private review; use a token without access to private repositories
   once that should stop. The container then forwards exactly one request, `GET /gh/issues`, to GitHub's issue
   search (`org:<GITHUB_ORG> is:issue is:open`, the 100 most recently updated) with that token, drops every header
   and query parameter of the visitor and every header of GitHub's answer except the JSON body, and lets Cloudflare
   and browsers cache the answer for five minutes. Without the token the page says that the list is not available
   yet and links to GitHub. Fine-grained tokens expire: put a reminder in the calendar, an expired token shows as
   "could not be loaded" on the page.

## Nginx Proxy Manager

- Proxy host `tavrn.org` (and `www.tavrn.org` if wanted): scheme `http`, forward hostname `website`, port `8080`.
- SSL: a certificate for the domain (Let's Encrypt with the DNS challenge works behind Cloudflare, or a Cloudflare
  origin certificate), "Force SSL" on. HSTS is set by the container already; NPM's HSTS switch can stay off.
- "Block common exploits" may stay on; caching in NPM off (Cloudflare caches).
- No custom headers are needed: the container sets all security headers, and NPM passes them through.

## Cloudflare

- DNS: the `tavrn.org` record **proxied** (orange cloud).
- SSL/TLS encryption mode **Full (strict)**: Cloudflare checks the certificate NPM presents.
- Cloudflare passes the container's headers through (CSP, HSTS, Referrer-Policy, …); do not add transform rules
  that change them.
- Cache rules (suggestions):
  - `/_astro/*`: cache everything, edge TTL one year (the files are content-hashed and sent as `immutable`).
  - `/config.json`, `/status`, `/status/`, `/uptime/*`, `/.well-known/*`: **bypass** the cache (runtime values; the
    status page's live data comes from the node directly, the uptime history through `/uptime/`).
  - `/gh/*`: **cache** (eligible for cache, respect the origin's `Cache-Control: public, max-age=300`). Cloudflare
    does not cache extension-less paths by default, and this rule is what keeps GitHub's search limit (30 requests
    a minute per token) out of reach: with it GitHub sees about one request per five minutes and Cloudflare data
    centre, without it one per page view of `/issues`.
  - Everything else: respect the origin's headers (HTML is `no-cache`, other files one hour).
- Features that set cookies or inject scripts (Web Analytics, Rocket Loader, Email Obfuscation, Zaraz, Bot Fight
  Mode challenges) stay **off**: the privacy policy promises no cookies and no third-party scripts, and the CSP would
  block injected scripts anyway.

## Logs and privacy

The container's access log on stdout contains no IP addresses (neither the connection's nor `CF-Connecting-IP` or
`X-Forwarded-For`) and no user agent, so the proxies do not need to be trusted for client IPs. The compose file
limits the log to three rotating files of 10 MB. NPM keeps its own access logs: switch them off for this proxy
host, or keep them short, so the privacy policy ("our server does not log IP addresses") stays true.

## Checks after a deployment

```sh
curl -sI https://tavrn.org/ | grep -i -E 'content-security-policy|strict-transport|cache-control'
curl -s https://tavrn.org/config.json
curl -s https://tavrn.org/legal/imprint/ | grep -o '<address.*</address>'   # the values of TAVRN_IMPRINT_*, no {{env …}}
curl -sI https://tavrn.org/app | grep -i location
curl -s https://tavrn.org/.well-known/tavrn     # 404 unless TAVRN_WELLKNOWN is on or proxy
curl -sI https://tavrn.org/gh/issues | grep -i -E '^HTTP|cache-control|cf-cache-status'   # 404 without GITHUB_READ_TOKEN
```
