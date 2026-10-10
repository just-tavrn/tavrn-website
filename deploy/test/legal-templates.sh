#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Checks in Docker how the container fills the imprint and contact details into the two legal pages: the exact
# Caddyfile and entrypoint.sh serving the built site (dist/, when `pnpm build` has run; else fixtures with the same
# template actions). Asserts that /legal/imprint/ and /legal/privacy/ show the values of the environment under every
# path a visitor can use, that & < > " ' in a value arrive as entities and CR/LF are dropped, that no template action
# ({{) is left, that a contact address that is not plain falls back, that the defaults and the warning appear without
# the variables, and that no other page is a template: a fixture page with a literal {{env "…"}} is served untouched.
#   just legal-templates-test   (needs Docker, the image caddy:2-alpine, ports 18092 and 18093 free)
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
port="${LEGAL_TEMPLATES_TEST_PORT:-18092}"
id="tavrn-legal-$$"
work="$(mktemp -d)"
cleanup() {
  docker rm -f "$id-set" "$id-default" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

: >"$work/csp-script-hashes.txt"
mkdir -p "$work/srv"
if [ -f "$root/dist/legal/imprint/index.html" ] && [ -f "$root/dist/legal/privacy/index.html" ]; then
  echo "     serving the built site (dist/)"
  cp -R "$root/dist/." "$work/srv/"
else
  echo "     no build in dist/: serving fixtures"
  mkdir -p "$work/srv/legal/imprint" "$work/srv/legal/privacy"
  echo '<h1>site</h1>' >"$work/srv/index.html"
  echo '<h1>404</h1>' >"$work/srv/404.html"
  cat >"$work/srv/legal/imprint/index.html" <<'HTML'
<!DOCTYPE html><html lang="en"><body><h1>Imprint</h1>
<address translate="no">{{env "TAVRN_IMPRINT_NAME"}}<br>{{env "TAVRN_IMPRINT_STREET"}}<br>{{env "TAVRN_IMPRINT_CITY"}}<br>{{env "TAVRN_IMPRINT_COUNTRY"}}</address>
<p>E-mail: <a href='mailto:{{env "TAVRN_CONTACT_EMAIL"}}' translate="no">{{env "TAVRN_CONTACT_EMAIL"}}</a></p>
<p><span translate="no">{{env "TAVRN_IMPRINT_NAME"}}</span></p></body></html>
HTML
  cat >"$work/srv/legal/privacy/index.html" <<'HTML'
<!DOCTYPE html><html lang="en"><body><h1>Privacy policy</h1>
<address translate="no">{{env "TAVRN_IMPRINT_NAME"}}<br>{{env "TAVRN_IMPRINT_STREET"}}<br>{{env "TAVRN_IMPRINT_CITY"}}<br>{{env "TAVRN_IMPRINT_COUNTRY"}}<br>
E-mail: <a href='mailto:{{env "TAVRN_CONTACT_EMAIL"}}'>{{env "TAVRN_CONTACT_EMAIL"}}</a></address>
<p><code translate="no">{{env "TAVRN_NODE_HOST"}}</code></p></body></html>
HTML
fi
# A page outside the two legal pages whose text happens to contain template actions: it must stay as it is.
mkdir -p "$work/srv/not-a-template"
echo '<!DOCTYPE html><p>{{env "TAVRN_IMPRINT_NAME"}} {{env "HOME"}} {{.Req.URL}}</p>' >"$work/srv/not-a-template/index.html"
echo '{{env "TAVRN_IMPRINT_NAME"}}' >"$work/srv/not-a-template.txt"
chmod -R a+rX "$work"

site() { # name, host port, extra docker args...
  local name="$1" hostport="$2"
  shift 2
  docker run -d --name "$name" -p "127.0.0.1:$hostport:8080" \
    -v "$root/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$work/csp-script-hashes.txt:/etc/caddy/csp-script-hashes.txt:ro" \
    -v "$work/srv:/srv:ro" -v "$root/deploy/entrypoint.sh:/usr/local/bin/tavrn-website:ro" \
    --entrypoint /usr/local/bin/tavrn-website "$@" caddy:2-alpine >/dev/null
}
# Values with HTML metacharacters, a CR at the end (pasted from a Windows file) and a node URL with port and path.
site "$id-set" "$port" \
  -e 'TAVRN_IMPRINT_NAME=Jane "JD" Doe & <b>Co</b>' \
  -e "TAVRN_IMPRINT_STREET=$(printf "O'Brien Street 1\r")" \
  -e 'TAVRN_IMPRINT_CITY=12345 Exampletown' \
  -e 'TAVRN_IMPRINT_COUNTRY=Austria' \
  -e 'TAVRN_CONTACT_EMAIL= jane.doe+web@example.org ' \
  -e 'TAVRN_NODE_URL=https://node.example.org:8443/'
# No imprint variables, and a contact address that would leave the href.
site "$id-default" "$((port + 1))" -e "TAVRN_CONTACT_EMAIL=x@example.org' onmouseover='alert(1)"

for p in "$port" "$((port + 1))"; do
  for _ in $(seq 1 50); do curl -fs -o /dev/null "http://127.0.0.1:$p/" && break; sleep 0.2; done
done

fail=0
check() { # description, condition (exit status of the previous command)
  if [ "$2" -eq 0 ]; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi
}
get() { curl -fs "http://127.0.0.1:$1$2"; }
has() { grep -qF -- "$2" <<<"$1"; }

name='Jane &quot;JD&quot; Doe &amp; &lt;b&gt;Co&lt;/b&gt;'
for path in /legal/imprint /legal/imprint/ /legal/imprint/index.html /legal/privacy /legal/privacy/ /legal/privacy/index.html; do
  page="$(get "$port" "$path")" || page=""
  [ -n "$page" ] && ! has "$page" '{{' && has "$page" "$name" && has "$page" 'O&#39;Brien Street 1<br>' \
    && has "$page" '12345 Exampletown' && has "$page" 'Austria' \
    && has "$page" "href='mailto:jane.doe+web@example.org'" && has "$page" '>jane.doe+web@example.org</a>'
  check "$path shows the values of the environment, no template action left" $?
  ! has "$page" 'Jane "JD"' && ! has "$page" '<b>Co' && ! grep -q $'\r' <<<"$page"
  check "$path: & < > \" ' arrive as entities, CR dropped" $?
done
page="$(get "$port" /legal/privacy/)"
has "$page" '<code translate="no">node.example.org:8443</code>'; check "the privacy policy names the host of TAVRN_NODE_URL" $?
page="$(get "$port" /legal/imprint/)"
has "$page" "<span translate=\"no\">$name</span>" && has "$page" '<address translate="no">'
check "the imprint keeps translate=\"no\" on the provider" $?

curl -s -D "$work/headers" -o /dev/null "http://127.0.0.1:$port/legal/imprint/"
tr -d '\r' <"$work/headers" >"$work/h"
grep -qi '^HTTP/1.1 200' "$work/h" && grep -qi '^content-type: text/html' "$work/h" && grep -qi '^cache-control: no-cache$' "$work/h" \
  && grep -qi '^content-security-policy:' "$work/h"
check "the rendered page keeps status, type, no-cache and the CSP" $?
page="$(curl -fs --compressed -H 'Accept-Encoding: gzip' "http://127.0.0.1:$port/legal/imprint/")"
has "$page" "$name" && ! has "$page" '{{'; check "a gzip-compressed answer is rendered too" $?

page="$(get "$port" /not-a-template/)"
[ "$page" = '<!DOCTYPE html><p>{{env "TAVRN_IMPRINT_NAME"}} {{env "HOME"}} {{.Req.URL}}</p>' ]
check "another HTML page with template actions is served untouched" $?
[ "$(get "$port" /not-a-template.txt)" = '{{env "TAVRN_IMPRINT_NAME"}}' ]; check "a text file with a template action is served untouched" $?
if [ -f "$work/srv/legal/index.html" ]; then
  page="$(get "$port" /legal/)"
  [ "$page" = "$(cat "$work/srv/legal/index.html")" ]; check "/legal/ itself is served as built" $?
fi

for path in /legal/imprint/ /legal/privacy/; do
  page="$(get "$((port + 1))" "$path")" || page=""
  [ -n "$page" ] && ! has "$page" '{{' && has "$page" 'Name of the provider<br>Street and number<br>Postal code and city<br>Germany' \
    && has "$page" "href='mailto:hello@tavrn.org'" && ! has "$page" 'onmouseover' && ! has "$page" 'example.org'
  check "$path without the variables: placeholders, the default contact address instead of the unusable one" $?
done
page="$(get "$((port + 1))" /legal/privacy/)"
grep -qE '<code translate="no">[a-z0-9.-]+</code>' <<<"$page"; check "the privacy policy names the default node's host" $?

logs="$(docker logs "$id-default" 2>&1)"
[ "$(grep -c 'show placeholders' <<<"$logs")" = 1 ] && grep -q 'TAVRN_CONTACT_EMAIL is not a plain e-mail address' <<<"$logs"
check "entrypoint.sh warns once about the placeholders and about the contact address" $?
! docker logs "$id-set" 2>&1 | grep -qE 'show placeholders|not a plain e-mail|no usable host'
check "no warning when everything is set" $?

exit "$fail"
