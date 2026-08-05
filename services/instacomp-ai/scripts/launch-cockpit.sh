#!/usr/bin/env bash
set -euo pipefail

SERVICE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COCKPIT_URL="${INSTACOMP_AI_COCKPIT_URL:-http://127.0.0.1:8787/control}"
HEALTH_URL="${INSTACOMP_AI_HEALTH_URL:-http://127.0.0.1:8787/health}"
SERVICE_LABEL="com.tcos.instacomp-ai.service"
LOG_DIR="$SERVICE_ROOT/data/logs"
LAUNCH_LOG="$LOG_DIR/desktop-launcher.log"
USER_DOMAIN="gui/$(id -u)"

mkdir -p "$LOG_DIR"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LAUNCH_LOG"
}

healthy() {
  /usr/bin/curl --fail --silent --show-error --max-time 2 "$HEALTH_URL" >/dev/null 2>&1
}

notify_failure() {
  local message="$1"
  log "ERROR: $message"
  /usr/bin/osascript -e "display alert \"InstaComp AI could not launch\" message \"$message\n\nOpen the InstaComp AI logs folder for details.\" as critical buttons {\"Open Logs\", \"OK\"} default button \"Open Logs\"" \
    -e 'if button returned of result is "Open Logs" then return "open"' 2>/dev/null | /usr/bin/grep -q open && /usr/bin/open "$LOG_DIR" || true
}

start_ollama_best_effort() {
  if /usr/bin/curl --fail --silent --max-time 1 "http://127.0.0.1:11434/api/tags" >/dev/null 2>&1; then
    return 0
  fi

  if [[ -d "/Applications/Ollama.app" ]] || [[ -d "$HOME/Applications/Ollama.app" ]]; then
    log "Starting Ollama application"
    /usr/bin/open -gja Ollama >/dev/null 2>&1 || true
  elif command -v ollama >/dev/null 2>&1; then
    log "Starting ollama serve"
    nohup "$(command -v ollama)" serve >> "$LOG_DIR/ollama.stdout.log" 2>> "$LOG_DIR/ollama.stderr.log" < /dev/null &
  else
    log "Ollama is not installed; cockpit can still open with AI marked unavailable"
  fi
}

start_service() {
  if /bin/launchctl print "$USER_DOMAIN/$SERVICE_LABEL" >/dev/null 2>&1; then
    log "Kickstarting $SERVICE_LABEL"
    /bin/launchctl kickstart -k "$USER_DOMAIN/$SERVICE_LABEL" >> "$LAUNCH_LOG" 2>&1 || true
  elif [[ -x "$SERVICE_ROOT/scripts/run-local.sh" ]]; then
    log "LaunchAgent is unavailable; starting the local service directly"
    nohup "$SERVICE_ROOT/scripts/run-local.sh" >> "$LOG_DIR/service.stdout.log" 2>> "$LOG_DIR/service.stderr.log" < /dev/null &
  else
    notify_failure "The local service launcher is missing. Run scripts/install-macos.sh again."
    exit 1
  fi
}

log "Desktop cockpit launch requested"

if healthy; then
  log "Service already healthy; opening cockpit"
  /usr/bin/open "$COCKPIT_URL"
  exit 0
fi

start_ollama_best_effort
start_service

for _ in $(/usr/bin/seq 1 60); do
  if healthy; then
    log "Service became healthy; opening cockpit"
    /usr/bin/open "$COCKPIT_URL"
    exit 0
  fi
  /bin/sleep 0.5
done

notify_failure "The local service did not become ready within 30 seconds."
exit 1
