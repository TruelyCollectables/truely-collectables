#!/usr/bin/env bash
set -euo pipefail

# This script is started as a FastAPI background task after the settings
# response has been returned to the browser.
sleep 1

if [[ "$(uname -s)" != "Darwin" ]] || ! command -v launchctl >/dev/null 2>&1; then
  exit 0
fi

label="${INSTACOMP_AI_LAUNCHD_LABEL:-com.truelycollectables.instacomp-ai}"
domain="gui/$(id -u)"

if launchctl print "${domain}/${label}" >/dev/null 2>&1; then
  launchctl kickstart -k "${domain}/${label}"
  exit 0
fi

# Older or manually installed configurations may use a plist without a loaded
# service. Attempt a bounded bootstrap from the standard LaunchAgents folder.
plist="${HOME}/Library/LaunchAgents/${label}.plist"
if [[ -f "$plist" ]]; then
  launchctl bootstrap "$domain" "$plist" 2>/dev/null || true
  launchctl kickstart -k "${domain}/${label}"
  exit 0
fi

exit 1
