#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
#
# Starts Caddy with the website's Caddyfile. Caddy cannot rewrite one variable into another, so the WebSocket URL of
# the delegation document is derived here from TAVRN_NODE_URL (https -> wss, http -> ws, plus /api/v1/ws) unless
# TAVRN_NODE_WS_URL is set explicitly. The default must match the one in the Caddyfile. It also checks the two
# values of the known-issues proxy (GITHUB_ORG, GITHUB_READ_TOKEN).
set -eu

# URLs without a trailing slash (the Caddyfile appends paths, and reverse_proxy accepts no path at all).
for var in TAVRN_APP_URL TAVRN_NODE_URL TAVRN_NODE_WS_URL UPTIME_KUMA_URL; do
  eval "value=\${$var:-}"
  # shellcheck disable=SC2154
  if [ -n "$value" ]; then export "$var=${value%/}"; fi
done

# The known-issues proxy (/gh/issues). Caddy substitutes these values into the Caddyfile as text, so only what a
# GitHub organization name or token can contain gets through. GITHUB_ORG also accepts the organization's URL.
org="${GITHUB_ORG:-just-tavrn}"
org="$(printf '%s' "$org" | tr -d '[:space:]')"
org="${org#https://github.com/}"
org="${org#http://github.com/}"
org="${org#github.com/}"
org="${org%/}"
case "$org" in
  '' | -* | *[!A-Za-z0-9-]*)
    echo "tavrn-website: GITHUB_ORG \"$org\" is not a GitHub organization name; using just-tavrn" >&2
    org=just-tavrn
    ;;
esac
export GITHUB_ORG="$org"

token="$(printf '%s' "${GITHUB_READ_TOKEN:-}" | tr -d '[:space:]')"
case "$token" in
  *[!A-Za-z0-9_]*)
    echo "tavrn-website: GITHUB_READ_TOKEN contains characters a GitHub token does not have; the known-issues list stays off" >&2
    token=
    ;;
esac
export GITHUB_READ_TOKEN="$token"

if [ -z "${TAVRN_NODE_WS_URL:-}" ]; then
  node_url="${TAVRN_NODE_URL:-https://tavrn.swsp.eu}"
  case "$node_url" in
    https://*) ws="wss://${node_url#https://}" ;;
    http://*) ws="ws://${node_url#http://}" ;;
    *) ws="$node_url" ;;
  esac
  TAVRN_NODE_WS_URL="$ws/api/v1/ws"
  export TAVRN_NODE_WS_URL
fi

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
