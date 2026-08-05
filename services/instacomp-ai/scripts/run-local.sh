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

mapfile -t runtime_settings < <(
  "$python_bin" - <<'PY'
from app.config import settings

print(settings.host)
print(settings.port)
print("configured" if settings.api_key else "missing")
PY
)
host="${runtime_settings[0]:-127.0.0.1}"
port="${runtime_settings[1]:-8787}"
api_key_state="${runtime_settings[2]:-missing}"

case "$host" in
  127.0.0.1|localhost|::1) ;;
  *)
    if [[ "$api_key_state" != "configured" ]]; then
      echo "Refusing to expose InstaComp AI beyond localhost without INSTACOMP_AI_API_KEY." >&2
      exit 2
    fi
    ;;
esac

exec "$python_bin" -m uvicorn app.main:app --host "$host" --port "$port"
