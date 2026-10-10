#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Checks the known-issues proxy of deploy/Caddyfile (GET /gh/issues) in Docker against a fake GitHub API
# (deploy/test/fake-github.py): the exact Caddyfile and entrypoint.sh, with only the upstream address replaced.
# Asserts the upstream request (fixed search query, client query ignored, token and API headers added, no client
# header passed on) and the response (body only, application/json, five-minute cache, no cookies or GitHub
# headers), the 404 without a token, and that other methods are not forwarded.
#   just gh-proxy-test        (needs Docker, the images caddy:2-alpine and python:3.12-slim, port 18089 free)
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
port="${GH_PROXY_TEST_PORT:-18089}"
id="tavrn-ghproxy-$$"
work="$(mktemp -d)"
cleanup() {
  docker rm -f "$id-fake" "$id-site" "$id-off" "$id-bad" >/dev/null 2>&1 || true
  docker network rm "$id" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

sed 's#reverse_proxy https://api.github.com#reverse_proxy http://fake:8000#' "$root/deploy/Caddyfile" >"$work/Caddyfile"
grep -q 'reverse_proxy http://fake:8000' "$work/Caddyfile"
: >"$work/csp-script-hashes.txt"
mkdir -p "$work/srv" && echo '<h1>site</h1>' >"$work/srv/index.html" && echo '<h1>404</h1>' >"$work/srv/404.html"
chmod -R a+rX "$work"

docker network create "$id" >/dev/null
docker run -d --name "$id-fake" --network "$id" --network-alias fake \
  -v "$root/deploy/test/fake-github.py:/fake.py:ro" python:3.12-slim python3 /fake.py >/dev/null

site() { # name, host port, extra docker args...
  local name="$1" hostport="$2"
  shift 2
  docker run -d --name "$name" --network "$id" -p "127.0.0.1:$hostport:8080" \
    -v "$work/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$work/csp-script-hashes.txt:/etc/caddy/csp-script-hashes.txt:ro" \
    -v "$work/srv:/srv:ro" -v "$root/deploy/entrypoint.sh:/usr/local/bin/tavrn-website:ro" \
    --entrypoint /usr/local/bin/tavrn-website "$@" caddy:2-alpine >/dev/null
}
# The token and the organization arrive with the whitespace and URL form operators paste.
site "$id-site" "$port" -e "GITHUB_READ_TOKEN= faketoken_for_tests " -e "GITHUB_ORG=https://github.com/example-org/"
site "$id-off" "$((port + 1))"
# Values that would change the Caddyfile if they reached it as text.
site "$id-bad" "$((port + 2))" -e 'GITHUB_READ_TOKEN=abc" {
respond 200' -e 'GITHUB_ORG=evil+repo:x/y'

for p in "$port" "$((port + 1))" "$((port + 2))"; do
  for _ in $(seq 1 50); do curl -fs "http://127.0.0.1:$p/" >/dev/null && break; sleep 0.2; done
done

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
curl -s -D "$work/headers" -o "$work/body" "${visitor[@]}" "http://127.0.0.1:$port/gh/issues?q=repo:evil/evil&per_page=1"

python3 - "$work/body" <<'PY' && r=0 || r=$?
import json, sys
seen = json.load(open(sys.argv[1]))["seen"]
h = {k.lower(): v for k, v in seen["headers"].items()}
expected_path = "/search/issues?q=org:example-org+is:issue+is:open&sort=updated&order=desc&per_page=100"
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
PY
check "upstream gets the fixed query, the token and the API headers, nothing from the visitor" "$r"

tr -d '\r' <"$work/headers" >"$work/h"
grep -qi '^HTTP/1.1 200' "$work/h"; check "answers 200" $?
grep -qi '^content-type: application/json; charset=utf-8$' "$work/h"; check "content-type application/json" $?
[ "$(grep -ci '^cache-control:' "$work/h")" = 1 ] && grep -qi '^cache-control: public, max-age=300$' "$work/h"
check "exactly one Cache-Control: public, max-age=300" $?
! grep -qiE '^(set-cookie|x-ratelimit|x-github|x-oauth|etag|link|via):' "$work/h"; check "no Set-Cookie, Via or GitHub headers" $?
curl -s --compressed -o "$work/gz" -H 'Accept-Encoding: gzip' "http://127.0.0.1:$port/gh/issues" && python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$work/gz"
check "a gzip-compressed answer decodes to the same JSON" $?
[ "$(grep -ci '^content-security-policy:' "$work/h")" = 1 ] && ! grep -qi "^content-security-policy: default-src 'none'" "$work/h"
check "only our own Content-Security-Policy" $?
echo "     response headers: $(grep -oiE '^[a-z-]+:' "$work/h" | tr '\n' ' ')"

code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$port/gh/issues")"
[ "$code" != 200 ] && [ "$code" != 502 ]; check "POST is not forwarded ($code)" $?
code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/gh/issues/1")"
[ "$code" = 404 ]; check "other paths under /gh/ are 404 ($code)" $?
code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$((port + 1))/gh/issues")"
[ "$code" = 404 ]; check "without GITHUB_READ_TOKEN /gh/issues is 404 ($code)" $?

code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$((port + 2))/gh/issues")"
[ "$code" = 404 ]; check "a token with foreign characters is refused: /gh/issues is 404 ($code)" $?
docker logs "$id-bad" 2>&1 | grep -q 'GITHUB_READ_TOKEN contains characters' && docker logs "$id-bad" 2>&1 | grep -q 'is not a GitHub organization name'
check "entrypoint.sh warns about both values" $?

exit "$fail"
