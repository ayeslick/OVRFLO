#!/usr/bin/env bash
#
# a11y-sweep.sh — R23
#
# Boots `npm run dev` and runs @axe-core/cli against the dashboard (the
# OVRFLO app is a single route — the modals, streams table, and status
# panels all render inside it). Fails non-zero on any Serious / Critical
# axe finding. Modal + streams-table a11y is additionally covered by
# unit tests; contributors should still open both modals manually and
# re-run the sweep if a regression is suspected.
#
# Contributor use:
#   npm run a11y             # sweep against a running dev server
#   URL=http://localhost:3000 npm run a11y   # override base URL
#
# Requires @axe-core/cli (installed as a devDep). If the dev server
# isn't running this script boots one and tears it down on exit.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BASE_URL="${URL:-http://localhost:3000}"
# Tags map to axe rule sets. wcag2a + wcag2aa cover Serious/Critical;
# best-practice catches common polish items we want to enforce anyway.
AXE_TAGS="wcag2a,wcag2aa,best-practice"

ROUTES=(
  "$BASE_URL"
)

# Optional: boot the dev server if nothing is listening on the port.
DEV_PID=""
cleanup() {
  if [[ -n "$DEV_PID" ]] && kill -0 "$DEV_PID" 2>/dev/null; then
    kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if ! curl -fsS -o /dev/null "$BASE_URL" 2>/dev/null; then
  echo "a11y-sweep: starting next dev on $BASE_URL..."
  (cd "$WEB_ROOT" && npm run dev >/tmp/ovrflo-a11y-dev.log 2>&1) &
  DEV_PID=$!
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "$BASE_URL" 2>/dev/null; then break; fi
    sleep 1
  done
  if ! curl -fsS -o /dev/null "$BASE_URL" 2>/dev/null; then
    echo "a11y-sweep: dev server failed to come up. Log:" >&2
    tail -50 /tmp/ovrflo-a11y-dev.log >&2 || true
    exit 1
  fi
fi

fail=0
for route in "${ROUTES[@]}"; do
  echo "a11y-sweep: axe $route"
  # --exit ensures non-zero exit when violations are found.
  # --tags limits to the Serious/Critical rule sets.
  if ! (cd "$WEB_ROOT" && npx --yes @axe-core/cli --exit --tags "$AXE_TAGS" "$route"); then
    fail=$((fail + 1))
  fi
done

if (( fail > 0 )); then
  echo "a11y-sweep: $fail route(s) reported Serious/Critical findings." >&2
  exit 1
fi

echo "a11y-sweep: clean at Serious/Critical on ${#ROUTES[@]} routes."
