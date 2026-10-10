# syntax=docker/dockerfile:1
# SPDX-License-Identifier: Apache-2.0
#
# The tavrn website: the static Astro build served by Caddy (deploy/Caddyfile).
#   docker build -f deploy/Dockerfile -t tavrn-website:dev .
# The two build arguments are the build-time values of the prerendered text (README.md, "Configuration"); everything
# else (node URL, app URL, Uptime Kuma, delegation, the imprint and contact details) comes from the environment of
# the container, so the image itself is generic and holds no personal data.

FROM node:24-alpine AS build
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
FROM caddy:2-alpine AS caddy
FROM alpine:3.22
LABEL org.opencontainers.image.title="tavrn-website" \
      org.opencontainers.image.description="The tavrn website (tavrn.org): static site served by Caddy" \
      org.opencontainers.image.source="https://github.com/just-tavrn/tavrn-website" \
      org.opencontainers.image.licenses="Apache-2.0 AND CC-BY-4.0"
RUN --mount=type=bind,from=caddy,source=/usr/bin/caddy,target=/mnt/caddy \
    apk add --no-cache ca-certificates && mkdir -p /etc/caddy && cp /mnt/caddy /usr/bin/caddy
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/entrypoint.sh /usr/local/bin/tavrn-website
COPY --from=build /app/dist /srv
COPY --from=build /app/csp-script-hashes.txt /etc/caddy/csp-script-hashes.txt
# Nothing is written at runtime (no certificates, no admin API, no persisted config): run unprivileged.
USER 65534:65534
ENV XDG_CONFIG_HOME=/tmp XDG_DATA_HOME=/tmp
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/config.json || exit 1
ENTRYPOINT ["/usr/local/bin/tavrn-website"]
