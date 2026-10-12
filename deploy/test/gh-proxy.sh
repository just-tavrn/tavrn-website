#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Checks the GitHub proxies of deploy/Caddyfile (GET /gh/issues, /gh/releases/web, /gh/releases/node, /gh/repos/web)
# in Docker against a fake GitHub API (deploy/test/fake-github.py): the exact Caddyfile, entrypoint.sh and
# update-feeds.sh, with only the upstream address replaced. Asserts for each route the upstream request (fixed URI,
# client query ignored, token and API headers added, no client header passed on) and the response (body only,
# application/json, five-minute cache, no cookies or GitHub headers), the 404 without a token or with an unusable one,
# that other methods and other paths under /gh/ are not forwarded. Then the desktop update feeds (/updates/desktop/…):
# each channel's feed files redirect to the right release (stable: the highest version that is no pre-release, beta:
# the highest of all, drafts and non-version tags never, per feed file), installers redirect by the version in their
# name, a channel without a release answers 404 no_release, no release list (no token, GitHub refuses) 503.
#   just gh-proxy-test        (needs Docker, the images caddy:2-alpine (plus jq, built here) and python:3.12-slim,
#                              ports 18089-18091 and 18094-18095 free; 18092-18093 are legal-templates.sh's)
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
port="${GH_PROXY_TEST_PORT:-18089}"
id="tavrn-ghproxy-$$"
work="$(mktemp -d)"
cleanup() {
  docker rm -f "$id-fake" "$id-site" "$id-off" "$id-bad" "$id-pre" "$id-refused" >/dev/null 2>&1 || true
  docker network rm "$id" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

sed 's#reverse_proxy https://api.github.com#reverse_proxy http://fake:8000#' "$root/deploy/Caddyfile" >"$work/Caddyfile"
grep -q 'reverse_proxy http://fake:8000' "$work/Caddyfile"
: >"$work/csp-script-hashes.txt"
mkdir -p "$work/srv" && echo '<h1>site</h1>' >"$work/srv/index.html" && echo '<h1>404</h1>' >"$work/srv/404.html"
chmod -R a+rX "$work"

# The runtime image's Caddy plus jq (deploy/Dockerfile adds it for update-feeds.sh).
image=tavrn-ghproxy-test:caddy-jq
printf 'FROM caddy:2-alpine\nRUN apk add --no-cache jq\n' | docker build -q -t "$image" - >/dev/null

docker network create "$id" >/dev/null
docker run -d --name "$id-fake" --network "$id" --network-alias fake \
  -v "$root/deploy/test/fake-github.py:/fake.py:ro" python:3.12-slim python3 /fake.py >/dev/null

site() { # name, host port, extra docker args...
  local name="$1" hostport="$2"
  shift 2
  docker run -d --name "$name" --network "$id" -p "127.0.0.1:$hostport:8080" \
    -v "$work/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$work/csp-script-hashes.txt:/etc/caddy/csp-script-hashes.txt:ro" \
    -v "$work/srv:/srv:ro" -v "$root/deploy/entrypoint.sh:/usr/local/bin/tavrn-website:ro" \
    -v "$root/deploy/update-feeds.sh:/usr/local/bin/tavrn-update-feeds:ro" \
    --entrypoint /usr/local/bin/tavrn-website "$@" "$image" >/dev/null
}
# The token and the organization arrive with the whitespace and URL form operators paste.
site "$id-site" "$port" -e "GITHUB_READ_TOKEN= faketoken_for_tests " -e "GITHUB_ORG=https://github.com/example-org/"
site "$id-off" "$((port + 1))"
# Values that would change the Caddyfile if they reached it as text.
site "$id-bad" "$((port + 2))" -e 'GITHUB_READ_TOKEN=abc" {
respond 200' -e 'GITHUB_ORG=evil+repo:x/y'
# Update feeds: a release list with pre-releases only, and a token GitHub refuses.
site "$id-pre" "$((port + 5))" -e "GITHUB_READ_TOKEN=faketoken_prereleases_only" -e "GITHUB_ORG=example-org"
site "$id-refused" "$((port + 6))" -e "GITHUB_READ_TOKEN=faketoken_unknown" -e "GITHUB_ORG=example-org"

for p in "$port" "$((port + 1))" "$((port + 2))" "$((port + 5))" "$((port + 6))"; do
  for _ in $(seq 1 50); do curl -fs "http://127.0.0.1:$p/" >/dev/null && break; sleep 0.2; done
done

# From here on every command is a check that reports its own status: with -e a failing one would end the script
# silently (no FAIL line, no later checks) and the cleanup would hide what happened.
set +e
fail=0
check() { # description, condition (exit status of the previous command)
  if [ "$2" -eq 0 ]; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi
}

# What a visitor's browser and the proxies in front may send; none of it may reach GitHub.
visitor=(
  -H 'Cookie: session=visitor'
  -H 'Authorization: Bearer visitor-token' # gitleaks:allow (a made-up value the proxy must drop)
  -H 'User-Agent: VisitorBrowser/1.0'
  -H 'X-Forwarded-For: 203.0.113.7'
  -H 'Cf-Connecting-Ip: 203.0.113.7'
  -H 'X-Real-Ip: 203.0.113.7'
  -H 'Forwarded: for=203.0.113.7'
  -H 'Referer: https://tavrn.org/issues'
  -H 'Accept-Language: de'
  -H 'X-Custom: leak'
)
# One route: what reached the fake GitHub (the fixed URI, the token and the API headers, nothing of the visitor) and
# what came back (body only, JSON, five-minute cache, no cookies or GitHub headers).
route() { # path the visitor asks for (with a query of its own), expected upstream path with query
  local ask="$1" expected="$2" name="${1%%\?*}"
  curl -s -D "$work/headers" -o "$work/body" "${visitor[@]}" "http://127.0.0.1:$port$ask"
  python3 - "$work/body" "$expected" <<'PY2' && r=0 || r=$?
import json, sys
seen = json.load(open(sys.argv[1]))["seen"]
h = {k.lower(): v for k, v in seen["headers"].items()}
expected_path = sys.argv[2]
problems = []
if seen["method"] != "GET": problems.append(f"method {seen['method']}")
if seen["path"] != expected_path: problems.append(f"path {seen['path']}")
want = {"authorization": "Bearer faketoken_for_tests", "accept": "application/vnd.github+json",
        "x-github-api-version": "2022-11-28", "user-agent": "tavrn-website", "host": "fake:8000"}
for k, v in want.items():
    if h.get(k) != v: problems.append(f"{k}: {h.get(k)!r}")
allowed = set(want) | {"accept-encoding"}
extra = sorted(set(h) - allowed)
if extra: problems.append(f"extra upstream headers: {extra}")
if "203.0.113.7" in json.dumps(seen) or "visitor" in json.dumps(seen).lower(): problems.append("visitor data upstream")
print("     upstream:", seen["path"], sorted(h))
for p in problems: print("     ", p)
sys.exit(1 if problems else 0)
PY2
  check "$name: upstream gets the fixed URI, the token and the API headers, nothing from the visitor" "$r"

  tr -d '\r' <"$work/headers" >"$work/h"
  grep -qi '^HTTP/1.1 200' "$work/h"; check "$name: answers 200" $?
  grep -qi '^content-type: application/json; charset=utf-8$' "$work/h"; check "$name: content-type application/json" $?
  [ "$(grep -ci '^cache-control:' "$work/h")" = 1 ] && grep -qi '^cache-control: public, max-age=300$' "$work/h"
  check "$name: exactly one Cache-Control: public, max-age=300" $?
  ! grep -qiE '^(set-cookie|x-ratelimit|x-github|x-oauth|etag|link|via):' "$work/h"; check "$name: no Set-Cookie, Via or GitHub headers" $?
  curl -s --compressed -o "$work/gz" -H 'Accept-Encoding: gzip' "http://127.0.0.1:$port$name" && python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$work/gz"
  check "$name: a gzip-compressed answer decodes to the same JSON" $?
  [ "$(grep -ci '^content-security-policy:' "$work/h")" = 1 ] && ! grep -qi "^content-security-policy: default-src 'none'" "$work/h"
  check "$name: only our own Content-Security-Policy" $?
  echo "     response headers: $(grep -oiE '^[a-z-]+:' "$work/h" | tr '\n' ' ')"

  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$port$name")"
  [ "$code" != 200 ] && [ "$code" != 502 ]; check "$name: POST is not forwarded ($code)" $?
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port$name/1")"
  [ "$code" = 404 ]; check "$name: paths below it are 404 ($code)" $?
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$((port + 1))$name")"
  [ "$code" = 404 ]; check "$name: without GITHUB_READ_TOKEN it is 404 ($code)" $?
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$((port + 2))$name")"
  [ "$code" = 404 ]; check "$name: with a token with foreign characters it is 404 ($code)" $?
}

route "/gh/issues?q=repo:evil/evil&per_page=1" "/search/issues?q=org:example-org+is:issue+is:open&sort=updated&order=desc&per_page=100"
route "/gh/releases/web?per_page=100&repo=evil" "/repos/example-org/tavrn-web/releases?per_page=20"
route "/gh/releases/node?page=2" "/repos/example-org/tavrn-node/releases?per_page=20"
route "/gh/repos/web?visibility=all" "/repos/example-org/tavrn-web"

for path in /gh/releases /gh/releases/ /gh/releases/other /gh/releases/tavrn-web /gh/repos /gh/repos/node /gh/repos/tavrn-web \
  /gh/repos/example-org/tavrn-web/releases /gh/; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port$path")"
  [ "$code" = 404 ]; check "other paths under /gh/ are 404: $path ($code)" $?
done

# docker logs may lag behind the entrypoint's start by a moment.
warned() { docker logs "$id-bad" 2>&1 | grep -q 'GITHUB_READ_TOKEN contains characters' && docker logs "$id-bad" 2>&1 | grep -q 'is not a GitHub organization name'; }
for _ in $(seq 1 50); do warned && break; sleep 0.2; done
warned; check "entrypoint.sh warns about both values" $?

# --- Desktop update feeds (/updates/desktop/<channel>/<file>) ---
# The release map is written in the background after the start: wait until the channels answer.
for p in "$port" "$((port + 5))"; do
  for _ in $(seq 1 100); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$p/updates/desktop/beta/latest.json")" != 503 ] && break
    sleep 0.3
  done
done

gh=https://github.com/example-org/tavrn-web/releases/download
redirect() { # description, port, path, expected Location
  local what="$1" p="$2" path="$3" want="$4"
  curl -s -D "$work/h" -o /dev/null "${visitor[@]}" "http://127.0.0.1:$p$path"
  tr -d '\r' <"$work/h" >"$work/hh"
  grep -q '^HTTP/1.1 302' "$work/hh" && [ "$(sed -n 's/^[Ll]ocation: //p' "$work/hh")" = "$want" ]
  check "$what: $path -> $(sed -n 's/^[Ll]ocation: //p' "$work/hh")" $?
}
problem() { # description, port, path, status, expected body
  local what="$1" p="$2" path="$3" status="$4" want="$5"
  code="$(curl -s -D "$work/h" -o "$work/body" -w '%{http_code}' "http://127.0.0.1:$p$path")"
  [ "$code" = "$status" ] && [ "$(cat "$work/body")" = "$want" ] && grep -qi '^content-type: application/json' "$work/h"
  check "$what: $path is $status $(cat "$work/body")" $?
}

redirect "stable: the highest version that is no pre-release and carries the feed" "$port" /updates/desktop/stable/latest.json "$gh/v0.5.1/latest.json"
redirect "stable: each feed file on its own (v0.5.1 has no Linux feed yet)" "$port" /updates/desktop/stable/latest-linux.yml "$gh/v0.5.0/latest-linux.yml"
redirect "stable: the Windows feed of the Electron shell" "$port" /updates/desktop/stable/latest.yml "$gh/v0.5.0/latest.yml"
redirect "stable: the signature comes from the feed's release" "$port" /updates/desktop/stable/latest.yml.minisig "$gh/v0.5.0/latest.yml.minisig"
redirect "beta: a release counts for beta too" "$port" /updates/desktop/beta/latest.json "$gh/v0.5.1/latest.json"
redirect "beta: the highest version including pre-releases (rc.10 > rc.9), no draft" "$port" /updates/desktop/beta/latest-linux.yml "$gh/v0.5.1-rc.10/latest-linux.yml"
redirect "beta: signature" "$port" /updates/desktop/beta/latest-linux.yml.minisig "$gh/v0.5.1-rc.10/latest-linux.yml.minisig"
redirect "installers by the version in their name (electron-updater asks next to the feed)" "$port" /updates/desktop/beta/Tavrn-0.5.1-rc.10.AppImage "$gh/v0.5.1-rc.10/Tavrn-0.5.1-rc.10.AppImage"
redirect "installers: the Debian package" "$port" /updates/desktop/stable/tavrn_0.5.0_amd64.deb "$gh/v0.5.0/tavrn_0.5.0_amd64.deb"
redirect "installers: the Windows block map of an older version (differential download)" "$port" /updates/desktop/beta/tavrn-electron_0.4.0-rc.1_x64-setup.exe.blockmap "$gh/v0.4.0-rc.1/tavrn-electron_0.4.0-rc.1_x64-setup.exe.blockmap"
redirect "pre-releases only: beta still has its release" "$((port + 5))" /updates/desktop/beta/latest.yml "$gh/v0.5.0-rc.2/latest.yml"
problem "a channel without a release" "$((port + 5))" /updates/desktop/stable/latest.json 404 '{"error":"no_release","channel":"stable"}'
problem "a channel without a release (signature)" "$((port + 5))" /updates/desktop/stable/latest-linux.yml.minisig 404 '{"error":"no_release","channel":"stable"}'
problem "no release list without a token" "$((port + 1))" /updates/desktop/beta/latest.json 503 '{"error":"unavailable","channel":"beta"}'
problem "no release list while GitHub refuses the token" "$((port + 6))" /updates/desktop/stable/latest.yml 503 '{"error":"unavailable","channel":"stable"}'

curl -s -D "$work/h" -o /dev/null "http://127.0.0.1:$port/updates/desktop/beta/latest.json"
tr -d '\r' <"$work/h" >"$work/hh"
[ "$(grep -ci '^cache-control:' "$work/hh")" = 1 ] && grep -qi '^cache-control: public, max-age=300$' "$work/hh" && ! grep -qiE '^(set-cookie|x-github|via):' "$work/hh"
check "feed redirects: exactly one Cache-Control: public, max-age=300, no cookies or GitHub headers" $?
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$port/updates/desktop/beta/latest.json")"
[ "$code" != 302 ]; check "POST is no redirect ($code)" $?
for path in /updates/desktop/nightly/latest.json /updates/desktop/stable/ /updates/desktop/stable /updates/desktop/beta/latest.exe \
  /updates/desktop/beta/Latest.json /updates/desktop/beta/../../etc/passwd /updates/desktop/beta/%2e%2e%2fsecret /updates/desktop/beta/x/latest.json \
  "/updates/desktop/beta/Tavrn-0.5.1.AppImage%0d%0aSet-Cookie:x" /updates/desktop/beta/Tavrn-latest.AppImage /updates/; do
  code="$(curl -s --path-as-is -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port$path")"
  [ "$code" = 404 ]; check "unknown update paths are 404: $path ($code)" $?
done
# update-feeds.sh starts a second after Caddy and logs the refusal after its first attempt: give it a moment.
for _ in $(seq 1 50); do docker logs "$id-refused" 2>&1 | grep -q 'update feeds: could not read the release list' && break; sleep 0.2; done
docker logs "$id-refused" 2>&1 | grep -q 'update feeds: could not read the release list'
check "update-feeds.sh logs a refused release list" $?
docker exec "$id-site" sh -c 'ps -o user,args | grep -v grep | grep -q tavrn-update-feeds'
check "the release map is refreshed by a background process" $?

exit "$fail"
