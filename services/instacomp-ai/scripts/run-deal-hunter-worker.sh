#!/usr/bin/env bash
set -euo pipefail
service_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$service_root"
if [[ -f "$service_root/.env" ]]; then
  set -a
  source "$service_root/.env"
  set +a
fi
export PYTHONPATH="$service_root${PYTHONPATH:+:$PYTHONPATH}"
export INSTACOMP_AI_DEAL_HUNTER_RUN_ON_STARTUP=false
exec /usr/bin/nice -n 10 "$service_root/.venv/bin/python" "$service_root/scripts/deal_hunter_worker.py"
