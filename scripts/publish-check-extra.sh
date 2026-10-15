# SPDX-License-Identifier: Apache-2.0
#
# The website's additions to scripts/publish-check.sh (sourced by it, in the checked directory; `here` is this
# repository's root). The default node host of the deployment (TAVRN_NODE_URL in deploy/.env.example) and its parent
# domain count as private while the official node lives under a private domain: they are searched everywhere, but the
# host may appear as the default value in the deployment files and the README (allow_files), nowhere else, and in no
# page text. The site's own domain (PUBLIC_SITE_URL, https://tavrn.org) and its subdomains never count as private.
# The owner's private pattern list in a sibling checkout of the internal repository is read when it exists.
# shellcheck shell=bash disable=SC2034,SC2154 # the variables are read by publish-check.sh, `here` comes from it

extra_lists=("$here/../tavrn-internal/publish-check.private")

site_host="${PUBLIC_SITE_URL:-https://tavrn.org}"
site_host="${site_host#*://}"; site_host="${site_host%%/*}"
for example in deploy/.env.example "$here/deploy/.env.example"; do
  [ -f "$example" ] || continue
  allow_value=$(sed -n 's#^TAVRN_NODE_URL=https\{0,1\}://\([^/ #]*\).*#\1#p' "$example" | head -n 1)
  [ -n "$allow_value" ] || continue
  for candidate in "$allow_value" "${allow_value#*.}"; do
    [[ "$candidate" == *.* ]] || continue
    [ "$candidate" = "$site_host" ] && continue
    [[ "$candidate" == *".$site_host" ]] && continue
    extra_patterns+=("$candidate")
  done
  break
done
allow_files=(deploy/docker-compose.yml deploy/.env.example deploy/Caddyfile deploy/entrypoint.sh README.md deploy/README.md)
