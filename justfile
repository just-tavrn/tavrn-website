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

# The download page's release data: the latest releases of tavrn-web and tavrn-node into src/data/downloads.json
# (keeps the committed cache when GitHub is unreachable or the repositories are private; GITHUB_TOKEN optional)
fetch-releases:
    pnpm fetch-releases

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

# The Caddyfile parses (in the official Caddy image)
caddy-validate:
    docker run --rm -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# The known-issues proxy (/gh/issues) of the Caddyfile against a fake GitHub API, in Docker (port 18089)
gh-proxy-test:
    deploy/test/gh-proxy.sh

# The container image (deploy/Dockerfile)
# Build arguments come from .build-args (gitignored; template build-args.example): the imprint and other build-time values.
docker-build tag="tavrn-website:dev":
    #!/usr/bin/env sh
    set -eu
    set --
    if [ -f .build-args ]; then
      while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in ""|\#*) ;; *) set -- "$@" --build-arg "$line" ;; esac
      done < .build-args
    fi
    docker build "$@" -f deploy/Dockerfile -t {{tag}} .

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
