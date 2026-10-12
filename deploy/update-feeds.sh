#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
#
# The release map behind the desktop apps' update feeds (deploy/Caddyfile, /updates/desktop/<channel>/<feed>).
# entrypoint.sh starts it next to Caddy when GITHUB_READ_TOKEN is set. Every five minutes it reads the 100 newest
# releases of tavrn-web through Caddy's internal GitHub proxy (http://127.0.0.1:8081/releases/web, which adds the
# token) and writes, for each channel and feed file, the tag of the release Caddy redirects to:
#   /tmp/tavrn-updates/<channel>-<feed>   the tag (v0.4.0, v0.5.0-rc.2), or empty: no release in that channel
#   /tmp/tavrn-updates/ready              written after the first good list; until then the feeds answer 503
# stable is the highest version that is neither a pre-release nor a draft, beta the highest version that is not a
# draft; both only among the releases that carry that feed file (a release without desktop builds, or one whose
# Linux build is still missing, is skipped for that file). "Highest" compares the tags as semantic versions
# (0.5.0 > 0.5.0-rc.10 > 0.5.0-rc.9); tags that are no v<major>.<minor>.<patch>[-<pre>] are ignored. A list that
# cannot be read or is not a release list leaves the last map in place. Only the release list is kept, as these
# few files; nothing of the feeds themselves is cached here.
set -u

dir=/tmp/tavrn-updates
source=http://127.0.0.1:8081/releases/web
interval=300
feeds="latest.json latest.yml latest-linux.yml"

# One "<channel> <feed> <tag>" line per channel and feed file ("-" for none).
# shellcheck disable=SC2016
program='
  def version: capture("^v(?<major>0|[1-9][0-9]*)\\.(?<minor>0|[1-9][0-9]*)\\.(?<patch>0|[1-9][0-9]*)(?:-(?<pre>[0-9A-Za-z]+(?:\\.[0-9A-Za-z]+)*))?$");
  def order: version | [(.major | tonumber), (.minor | tonumber), (.patch | tonumber), (if .pre == null then 1 else 0 end),
    ((.pre // "") | split(".") | map(if test("^[0-9]+$") then [0, tonumber] else [1, .] end))];
  if type != "array" then error("not a release list") else . end
  | [.[] | select(type == "object" and .draft == false and (.tag_name | type) == "string" and (.tag_name | test("^v[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z]+(\\.[0-9A-Za-z]+)*)?$")))] as $releases
  | ("stable", "beta") as $channel
  | ($feeds | split(" ")[]) as $feed
  | [$releases[] | select($channel == "beta" or .prerelease == false) | select(any(.assets[]?; .name == $feed))]
  | (if length == 0 then "-" else (max_by(.tag_name | order) | .tag_name) end) as $tag
  | "\($channel) \($feed) \($tag)"
'

log() {
  echo "tavrn-website: update feeds: $*" >&2
}

refresh() {
  list="$dir/.releases.json"
  if ! wget -q -T 20 -O "$list" "$source" 2>/dev/null; then
    log "could not read the release list (GitHub unreachable or the token refused); keeping the last map"
    return 1
  fi
  if ! map="$(jq -r --arg feeds "$feeds" "$program" "$list" 2>/dev/null)" || [ -z "$map" ]; then
    log "could not read the release list (not a list of releases); keeping the last map"
    return 1
  fi
  changed=
  while read -r channel feed tag; do
    [ "$tag" = - ] && tag=
    file="$dir/$channel-$feed"
    if [ ! -f "$file" ] || [ "$(cat "$file")" != "$tag" ]; then
      printf '%s' "$tag" >"$file.tmp" && mv "$file.tmp" "$file"
      changed="$changed $channel/$feed=${tag:-none}"
    fi
  done <<EOF
$map
EOF
  rm -f "$list"
  [ -n "$changed" ] && log "now$changed"
  : >"$dir/ready"
}

mkdir -p "$dir"
# Caddy starts in parallel: the first attempts come quickly, then every five minutes.
sleep 1
while :; do
  if refresh; then sleep "$interval"; else sleep 15; fi
done
