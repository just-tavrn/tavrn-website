# syntax=docker/dockerfile:1
# SPDX-License-Identifier: Apache-2.0
#
# The tavrn website: the static Astro build served by Caddy (deploy/Caddyfile).
#   docker build -f deploy/Dockerfile -t tavrn-website:dev .
# The two build arguments are the build-time values of the prerendered text (README.md, "Configuration"); everything
# else (node URL, app URL, Uptime Kuma, delegation, the imprint and contact details) comes from the environment of
# the container, so the image itself is generic and holds no personal data.
# Every base image is pinned by digest (Dependabot keeps tag and digest current); the tag says which release it is.

FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG PUBLIC_SITE_URL=https://tavrn.org
ARG PUBLIC_GITHUB_ORG=just-tavrn
ENV PUBLIC_SITE_URL=$PUBLIC_SITE_URL \
    PUBLIC_GITHUB_ORG=$PUBLIC_GITHUB_ORG \
    ASTRO_TELEMETRY_DISABLED=1
RUN pnpm build

# Runtime: a plain Alpine with only the caddy binary. It is copied with cp from a bind mount of the caddy image,
# which drops the file capability cap_net_bind_service the caddy image's binary carries (an unprivileged
# container with cap_drop ALL and no-new-privileges may not execute a binary with file capabilities; :8080
# needs none) and keeps it to one layer of ~40 MB. A plain COPY --from would preserve the capability.
FROM caddy:2-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f AS caddy
FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8
LABEL org.opencontainers.image.title="tavrn-website" \
      org.opencontainers.image.description="The tavrn website (tavrn.org): static site served by Caddy" \
      org.opencontainers.image.source="https://github.com/just-tavrn/tavrn-website" \
      org.opencontainers.image.licenses="Apache-2.0 AND CC-BY-4.0"
RUN --mount=type=bind,from=caddy,source=/usr/bin/caddy,target=/mnt/caddy \
    apk add --no-cache ca-certificates jq && mkdir -p /etc/caddy && cp /mnt/caddy /usr/bin/caddy
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/entrypoint.sh /usr/local/bin/tavrn-website
# The release map of the desktop update feeds (entrypoint.sh starts it; jq above reads the release list).
COPY deploy/update-feeds.sh /usr/local/bin/tavrn-update-feeds
COPY --from=build /app/dist /srv
COPY --from=build /app/csp-script-hashes.txt /etc/caddy/csp-script-hashes.txt
# Nothing is written at runtime except the update feeds' release map in /tmp (no certificates, no admin API, no
# persisted config): run unprivileged.
USER 65534:65534
ENV XDG_CONFIG_HOME=/tmp XDG_DATA_HOME=/tmp
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/config.json || exit 1
ENTRYPOINT ["/usr/local/bin/tavrn-website"]
