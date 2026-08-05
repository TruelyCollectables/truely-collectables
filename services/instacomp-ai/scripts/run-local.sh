#!/usr/bin/env bash
set -euo pipefail

service_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$service_root"

python_bin="${INSTACOMP_AI_PYTHON:-$service_root/.venv/bin/python}"
if [[ ! -x "$python_bin" ]]; then
  python3 -m venv "$service_root/.venv"
  python_bin="$service_root/.venv/bin/python"
  "$python_bin" -m pip install --upgrade pip
  "$python_bin" -m pip install -r "$service_root/requirements.txt"
fi

host="${INSTACOMP_AI_HOST:-127.0.0.1}"
port="${INSTACOMP_AI_PORT:-8787}"
api_key="${INSTACOMP_AI_API_KEY:-}"

case "$host" in
  127.0.0.1|localhost|::1) ;;
  *)
    if [[ -z "$api_key" ]]; then
      echo "Refusing to expose InstaComp AI beyond localhost without INSTACOMP_AI_API_KEY." >&2
      exit 2
    fi
    ;;
esac

exec "$python_bin" -m uvicorn app.main:app --host "$host" --port "$port"
