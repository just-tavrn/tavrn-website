# SPDX-License-Identifier: Apache-2.0
# Tasks of the tavrn website. `just check` is what has to be green before a commit.

set shell := ["bash", "-euo", "pipefail", "-c"]

port := env_var_or_default("E2E_PORT", "4400")

default:
    @just --list

# Install the dependencies from the lockfile
install:
    pnpm install --frozen-lockfile

# Development server with hot reload (http://localhost:4321)
dev:
    pnpm dev

# Copy the docs from the submodules under sources/ into the wiki (also part of dev, build and typecheck)
sync-docs:
    pnpm sync-docs

# Update the docs sources to the newest commit of their tracked branch (then review, build and commit sources/)
# Renders public/og.png from the brand background and the template (scripts/og/template.html).
og-image:
    node scripts/og-image.mjs

update-sources:
    git submodule update --init --remote --merge sources/

# Production build into dist/ (plus csp-script-hashes.txt for the container)
build:
    pnpm build

# Serve dist/ like the end-to-end tests do (http://127.0.0.1:4400)
preview:
    pnpm preview

# Typecheck (astro check: .astro, .ts)
typecheck:
    pnpm typecheck

# Unit tests and the checks of the built site (needs a build for tests/dist.test.ts)
test:
    pnpm test

# End-to-end tests: Chromium and the Android phone emulation, two workers (needs a build)
e2e *args:
    E2E_PORT={{port}} pnpm exec playwright test -c e2e/playwright.config.ts --project chromium --project mobile-android --workers=2 {{args}}

# The Caddyfile parses (in the Caddy image of deploy/Dockerfile, by digest)
caddy-validate:
    docker run --rm -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# The GitHub proxies of the Caddyfile (/gh/issues, /gh/releases/web, /gh/releases/node, /gh/repos/web) and the desktop
# update feeds (/updates/desktop/…) against a fake GitHub API, in Docker (ports 18089-18091, 18094-18095)
gh-proxy-test:
    deploy/test/gh-proxy.sh

# The imprint and contact details Caddy fills into the two legal pages at request time, in Docker (port 18092;
# uses dist/ when built, else fixtures)
legal-templates-test:
    deploy/test/legal-templates.sh

# Both Docker tests of the Caddyfile
caddy-test: gh-proxy-test legal-templates-test

# The container image (deploy/Dockerfile); generic: the imprint and contact details are runtime variables
docker-build tag="tavrn-website:dev":
    docker build -f deploy/Dockerfile -t {{tag}} .

# Run the image locally on port 18080 with the delegation document switched on
docker-run tag="tavrn-website:dev":
    docker run --rm -p 18080:8080 -e TAVRN_WELLKNOWN=on {{tag}}

# SPDX headers in every source file
spdx:
    scripts/check-spdx.sh

# Licenses of the production dependencies
licenses:
    node scripts/check-js-licenses.mjs

# Pre-publication hygiene: no private files, domains or secrets
publish-check:
    scripts/publish-check.sh

# Everything: typecheck, build, unit and dist tests, SPDX, licenses, publication hygiene, Caddyfile, end-to-end
check: typecheck build test spdx licenses publish-check caddy-validate e2e
