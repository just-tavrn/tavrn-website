#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
#
# Starts Caddy with the website's Caddyfile. Caddy cannot rewrite one variable into another, so the WebSocket URL of
# the delegation document is derived here from TAVRN_NODE_URL (https -> wss, http -> ws, plus /api/v1/ws) unless
# TAVRN_NODE_WS_URL is set explicitly. The default must match the one in the Caddyfile. It also checks the two
# values of the GitHub proxies (GITHUB_ORG, GITHUB_READ_TOKEN) and prepares the imprint and contact details that
# Caddy fills into the two legal pages (TAVRN_IMPRINT_*, TAVRN_CONTACT_EMAIL, TAVRN_NODE_HOST).
set -eu

default_node_url=https://tavrn.swsp.eu

# URLs without a trailing slash (the Caddyfile appends paths, and reverse_proxy accepts no path at all).
for var in TAVRN_APP_URL TAVRN_NODE_URL TAVRN_NODE_WS_URL UPTIME_KUMA_URL; do
  eval "value=\${$var:-}"
  # shellcheck disable=SC2154
  if [ -n "$value" ]; then export "$var=${value%/}"; fi
done

# The GitHub proxies (/gh/issues, /gh/releases/*, /gh/repos/web). Caddy substitutes these values into the Caddyfile as text, so only what a
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
    echo "tavrn-website: GITHUB_READ_TOKEN contains characters a GitHub token does not have; the known-issues list and the release lists stay off" >&2
    token=
    ;;
esac
export GITHUB_READ_TOKEN="$token"

if [ -z "${TAVRN_NODE_WS_URL:-}" ]; then
  node_url="${TAVRN_NODE_URL:-$default_node_url}"
  case "$node_url" in
    https://*) ws="wss://${node_url#https://}" ;;
    http://*) ws="ws://${node_url#http://}" ;;
    *) ws="$node_url" ;;
  esac
  TAVRN_NODE_WS_URL="$ws/api/v1/ws"
  export TAVRN_NODE_WS_URL
fi

# The imprint and contact details of the legal pages (/legal/imprint/, /legal/privacy/). The pages carry Go template
# actions like {{env "TAVRN_IMPRINT_NAME"}}, which Caddy's templates directive replaces at request time
# (deploy/Caddyfile, @legal). Caddy's templates are text/template and do not escape, and the values land in HTML
# (element text and a single-quoted href), so they are escaped here: line breaks (CR, LF) are removed, then sed turns
# & < > " ' into entities, & first so the other entities are not escaped twice. An unset or empty variable gets a
# visible placeholder (the contact address: the project's).
html_escape() {
  printf '%s' "$1" | tr -d '\r\n' | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&#39;/g"
}
if [ -z "${TAVRN_IMPRINT_NAME:-}" ] || [ -z "${TAVRN_IMPRINT_STREET:-}" ] || [ -z "${TAVRN_IMPRINT_CITY:-}" ]; then
  echo "tavrn-website: TAVRN_IMPRINT_NAME, TAVRN_IMPRINT_STREET or TAVRN_IMPRINT_CITY is not set; the imprint and the privacy policy show placeholders" >&2
fi
TAVRN_IMPRINT_NAME="$(html_escape "${TAVRN_IMPRINT_NAME:-Name of the provider}")"
TAVRN_IMPRINT_STREET="$(html_escape "${TAVRN_IMPRINT_STREET:-Street and number}")"
TAVRN_IMPRINT_CITY="$(html_escape "${TAVRN_IMPRINT_CITY:-Postal code and city}")"
TAVRN_IMPRINT_COUNTRY="$(html_escape "${TAVRN_IMPRINT_COUNTRY:-Germany}")"
export TAVRN_IMPRINT_NAME TAVRN_IMPRINT_STREET TAVRN_IMPRINT_CITY TAVRN_IMPRINT_COUNTRY

# The contact address is also the target of a mailto: link, so only a plain address gets through: one @ with
# something on both sides, no spaces, nothing that would add mail headers (?, &) or leave the attribute.
email="$(printf '%s' "${TAVRN_CONTACT_EMAIL:-hello@tavrn.org}" | tr -d '[:space:]')"
case "$email" in
  *[!A-Za-z0-9.@_%+-]* | *@*@* | @* | *@) email_ok= ;;
  *@*) email_ok=1 ;;
  *) email_ok= ;;
esac
if [ -z "$email_ok" ]; then
  echo "tavrn-website: TAVRN_CONTACT_EMAIL is not a plain e-mail address; using hello@tavrn.org" >&2
  email=hello@tavrn.org
fi
TAVRN_CONTACT_EMAIL="$(html_escape "$email")"
export TAVRN_CONTACT_EMAIL

# The node's host as the privacy policy names it: the host part (with port) of TAVRN_NODE_URL. Not set directly.
host_of() {
  h="${1#*://}"
  h="${h%%/*}"
  printf '%s' "${h##*@}"
}
node_host="$(host_of "${TAVRN_NODE_URL:-$default_node_url}")"
case "$node_host" in
  '' | *[!A-Za-z0-9.:-]*)
    echo "tavrn-website: TAVRN_NODE_URL has no usable host; the privacy policy names $(host_of "$default_node_url")" >&2
    node_host="$(host_of "$default_node_url")"
    ;;
esac
TAVRN_NODE_HOST="$(html_escape "$node_host")"
export TAVRN_NODE_HOST

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
