#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Makes all screenshots with one command: starts a fresh demo node and the web client's dev server, runs make.ts
# from a tavrn-web checkout, optimizes the PNGs and stops what it started. See README.md.
#
#   TAVRN_NODE_BIN=/path/to/tavrn-node TAVRN_WEB=/path/to/tavrn-web ./run.sh [out-dir]
#
# Optional: SHOTS_NODE_PORT (8700), SHOTS_WEB_PORT (5700), SHOTS_LIVEKIT_PORT (9700), SHOTS_RTC_TCP_PORT (10700),
# SHOTS_RTC_UDP_RANGE (50000-50149), SHOTS_MEDIA_IP (address of this machine on its default route), SHOTS_DATA
# (node data directory, emptied first; default: a new temporary directory, removed afterwards unless SHOTS_KEEP_DATA=1),
# SHOTS_ONLY / SHOTS_DEBUG (passed to make.ts).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$(realpath -m "${1:-$here/out}")"
: "${TAVRN_NODE_BIN:?set TAVRN_NODE_BIN to a tavrn-node binary}"
: "${TAVRN_WEB:?set TAVRN_WEB to a tavrn-web checkout with pnpm install done}"
node_port="${SHOTS_NODE_PORT:-8700}"
web_port="${SHOTS_WEB_PORT:-5700}"
media_ip="${SHOTS_MEDIA_IP:-$(ip -4 route get 192.0.2.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')}"
data="${SHOTS_DATA:-$(mktemp -d /tmp/tavrn-shots-node.XXXXXX)}"
started=()

cleanup() {
  # Each started server runs in its own process group (setsid): stop the whole group (pnpm, sh, vite; node, livekit).
  for pid in "${started[@]}"; do kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true; done
  rm -rf "$TAVRN_WEB/e2e/shots"
  if [ -z "${SHOTS_DATA:-}" ] && [ -z "${SHOTS_KEEP_DATA:-}" ]; then rm -rf "$data"; fi
}
trap cleanup EXIT

wait_for() { for _ in $(seq 1 240); do curl -sf -o /dev/null "$1" && return 0; sleep 0.5; done; echo "timeout waiting for $1" >&2; return 1; }

if curl -sf -o /dev/null "http://127.0.0.1:$node_port/healthz"; then echo "port $node_port is in use" >&2; exit 1; fi
if [ -n "$(ls -A "$data" 2>/dev/null)" ] && [ ! -e "$data/demo.db" ] && [ ! -e "$data/node.log" ]; then echo "$data is not empty and holds no demo node" >&2; exit 1; fi
rm -rf "$data" && mkdir -p "$data/data" "$out"
echo "node: $TAVRN_NODE_BIN ($("$TAVRN_NODE_BIN" --version 2>/dev/null || echo '?')), data in $data"
env=(TAVRN_DOMAIN=localhost TAVRN_LISTEN="127.0.0.1:$node_port"
  TAVRN_DATABASE_URL="sqlite://$data/demo.db?mode=rwc" TAVRN_DATA_DIR="$data/data"
  TAVRN_ADMIN_USERS=mira TAVRN_REGISTRATION=open TAVRN_ROOM_CREATION=local
  TAVRN_WEBAUTHN_ORIGIN="http://localhost:$web_port"
  TAVRN_LIVEKIT_PORT="${SHOTS_LIVEKIT_PORT:-9700}" TAVRN_RTC_UDP_PORT_RANGE="${SHOTS_RTC_UDP_RANGE:-50000-50149}"
  TAVRN_RTC_TCP_PORT="${SHOTS_RTC_TCP_PORT:-10700}")
[ -n "$media_ip" ] && env+=(TAVRN_RTC_EXTERNAL_IP="$media_ip")
setsid env "${env[@]}" "$TAVRN_NODE_BIN" --dev > "$data/node.log" 2>&1 &
started+=($!)
wait_for "http://127.0.0.1:$node_port/healthz"

if ! curl -sf -o /dev/null "http://localhost:$web_port/"; then
  (cd "$TAVRN_WEB" && E2E_NODE_PORT="$node_port" E2E_WEB_PORT="$web_port" exec setsid pnpm --filter @tavrn/web dev) > "$data/web.log" 2>&1 &
  started+=($!)
  wait_for "http://localhost:$web_port/"
else
  echo "using the dev server already running on port $web_port (it must proxy to port $node_port)"
fi
echo "web client: $(git -C "$TAVRN_WEB" rev-parse --short HEAD 2>/dev/null || echo '?')"

mkdir -p "$TAVRN_WEB/e2e/shots"
cp "$here/make.ts" "$here/playwright.config.ts" "$TAVRN_WEB/e2e/shots/"
status=0
(cd "$TAVRN_WEB/e2e" && SHOTS_OUT="$out" SHOTS_ASSETS="$here/assets" SHOTS_MANIFEST="$out/manifest.json" SHOTS_NODE_PORT="$node_port" SHOTS_WEB_PORT="$web_port" \
  npx playwright test -c shots/playwright.config.ts --project chromium --workers=1 2>&1 | tee "$data/playwright.log") || status=$?

# Lossless optimization: oxipng if installed, else the Python binding (pip install pyoxipng), else nothing.
if command -v oxipng >/dev/null; then
  oxipng -q -o 4 --strip safe "$out"/*.png || true
elif python3 -c "import oxipng" 2>/dev/null; then
  python3 - "$out" <<'PY'
import glob, sys, oxipng
for f in glob.glob(sys.argv[1] + "/*.png"):
    oxipng.optimize(f, level=4, strip=oxipng.StripChunks.safe())
PY
fi
ls -la "$out"
exit $status
