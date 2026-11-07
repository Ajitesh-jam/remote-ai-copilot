#!/usr/bin/env bash
# Launch a dedicated Chrome profile with remote debugging for the copilot.
# Do NOT use your default Chrome profile (Chrome 136+ blocks that).
set -euo pipefail

PROFILE_DIR="${HOME}/ChromeAgentProfile"
PORT="${COPILOT_CDP_PORT:-9222}"

mkdir -p "$PROFILE_DIR"

# Close nothing in your everyday Chrome — this is a separate profile/window.
open -na "Google Chrome" --args \
  --remote-debugging-port="${PORT}" \
  --user-data-dir="${PROFILE_DIR}" \
  --no-first-run \
  --no-default-browser-check \
  "about:blank"

echo "Chrome CDP profile started"
echo "  profile: ${PROFILE_DIR}"
echo "  endpoint: http://127.0.0.1:${PORT}"
echo ""
echo "Log into sites you need in THIS window, then:"
echo "  npm run copilot -- browser connect --mode cdp"
echo "  npm run copilot -- browser tabs"
echo "  npm run copilot -- browser read"
