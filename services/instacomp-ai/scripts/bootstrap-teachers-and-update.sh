#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This bootstrap is only allowed on the physical InstaComp Mac." >&2
  exit 2
fi

for command in bash curl git python3; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Missing required command: $command" >&2
    exit 2
  }
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
service_root="$(cd "$script_dir/.." && pwd)"
repo_root="$(git -C "$service_root" rev-parse --show-toplevel 2>/dev/null || true)"
env_file="$service_root/.env"
updater="$script_dir/update-live-from-main.sh"

if [[ -z "$repo_root" || "$service_root" != "$repo_root/services/instacomp-ai" ]]; then
  echo "Refusing bootstrap: unexpected InstaComp repository layout." >&2
  exit 2
fi
if [[ ! -x "$updater" ]]; then
  echo "Refusing bootstrap: $updater is missing or not executable." >&2
  exit 2
fi

read_env_value() {
  python3 - "$1" "$2" <<'PY'
import json
import pathlib
import shlex
import sys

path = pathlib.Path(sys.argv[1])
name = sys.argv[2]
if not path.is_file():
    raise SystemExit(0)
for raw in path.read_text("utf-8").splitlines():
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key.strip() != name:
        continue
    value = value.strip()
    try:
        if value.startswith('"'):
            print(json.loads(value))
        elif value.startswith("'"):
            print(shlex.split(value)[0] if value else "")
        else:
            print(value)
    except Exception:
        print(value.strip('"\''))
    break
PY
}

prompt_secret_if_missing() {
  local name="$1"
  local label="$2"
  local current=""
  current="$(read_env_value "$env_file" "$name")"
  if [[ -n "$current" ]]; then
    printf '%s' "$current"
    return 0
  fi
  local entered=""
  if [[ ! -t 0 ]]; then
    echo "Missing $name and no interactive terminal is available." >&2
    return 2
  fi
  read -r -s -p "$label: " entered
  echo >&2
  printf '%s' "$entered"
}

validate_secret_shape() {
  local name="$1"
  local value="$2"
  if [[ ${#value} -lt 20 || "$value" =~ [[:space:]] ]]; then
    echo "$name is missing or malformed." >&2
    return 2
  fi
}

write_teacher_keys() {
  local gemini_key="$1"
  local groq_key="$2"
  ENV_PATH="$env_file" GEMINI_VALUE="$gemini_key" GROQ_VALUE="$groq_key" python3 - <<'PY'
import json
import os
import pathlib
import shutil
from datetime import datetime, timezone

path = pathlib.Path(os.environ["ENV_PATH"])
path.parent.mkdir(parents=True, exist_ok=True)
if path.exists():
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = path.with_name(f"{path.name}.teacher-bootstrap-{timestamp}.bak")
    shutil.copy2(path, backup)
else:
    path.touch(mode=0o600)

updates = {
    "GEMINI_API_KEY": os.environ["GEMINI_VALUE"],
    "GROQ_API_KEY": os.environ["GROQ_VALUE"],
}
for key, value in updates.items():
    if not value or any(ch in value for ch in "\r\n"):
        raise SystemExit(f"Refusing malformed {key}")

lines = path.read_text("utf-8").splitlines()
seen = set()
out = []
for raw in lines:
    stripped = raw.strip()
    if stripped and not stripped.startswith("#") and "=" in stripped:
        key = stripped.split("=", 1)[0].strip()
        if key in updates:
            if key in seen:
                continue
            out.append(f"{key}={json.dumps(updates[key])}")
            seen.add(key)
            continue
    out.append(raw)
for key in ("GEMINI_API_KEY", "GROQ_API_KEY"):
    if key not in seen:
        out.append(f"{key}={json.dumps(updates[key])}")
path.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")
path.chmod(0o600)
print("PASS  Teacher credentials stored in the local InstaComp .env without printing values.")
PY
}

gemini_key="$(prompt_secret_if_missing GEMINI_API_KEY 'Paste Gemini API key')"
groq_key="$(prompt_secret_if_missing GROQ_API_KEY 'Paste Groq API key')"
validate_secret_shape GEMINI_API_KEY "$gemini_key"
validate_secret_shape GROQ_API_KEY "$groq_key"

gemini_model="$(read_env_value "$env_file" INSTACOMP_TEACHER_GEMINI_MODEL)"
groq_model="$(read_env_value "$env_file" INSTACOMP_TEACHER_GROQ_MODEL)"
gemini_model="${gemini_model:-gemini-3.6-flash}"
groq_model="${groq_model:-groq/compound}"

gemini_response="$(mktemp -t instacomp-gemini-models.XXXXXX)"
groq_response="$(mktemp -t instacomp-groq-models.XXXXXX)"
cleanup() {
  rm -f "$gemini_response" "$groq_response"
}
trap cleanup EXIT

curl --fail --silent --show-error --max-time 30 \
  -H "x-goog-api-key: $gemini_key" \
  "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000" \
  > "$gemini_response"
GEMINI_RESPONSE="$gemini_response" EXPECTED_MODEL="$gemini_model" python3 - <<'PY'
import json
import os
import pathlib

payload = json.loads(pathlib.Path(os.environ["GEMINI_RESPONSE"]).read_text("utf-8"))
expected = os.environ["EXPECTED_MODEL"].strip()
models = {
    str(item.get("name") or "").removeprefix("models/")
    for item in payload.get("models") or []
    if isinstance(item, dict)
}
if expected not in models:
    raise SystemExit(f"Gemini credential is valid, but configured model {expected!r} is not available to this account.")
print(f"PASS  Gemini credential accepted and model {expected} is available.")
PY

curl --fail --silent --show-error --max-time 30 \
  -H "Authorization: Bearer $groq_key" \
  "https://api.groq.com/openai/v1/models" \
  > "$groq_response"
GROQ_RESPONSE="$groq_response" EXPECTED_MODEL="$groq_model" python3 - <<'PY'
import json
import os
import pathlib

payload = json.loads(pathlib.Path(os.environ["GROQ_RESPONSE"]).read_text("utf-8"))
expected = os.environ["EXPECTED_MODEL"].strip()
models = {
    str(item.get("id") or "").strip()
    for item in payload.get("data") or []
    if isinstance(item, dict)
}
if expected not in models:
    raise SystemExit(f"Groq credential is valid, but configured model {expected!r} is not available to this account.")
print(f"PASS  Groq credential accepted and model {expected} is available.")
PY

write_teacher_keys "$gemini_key" "$groq_key"
unset gemini_key groq_key

bash "$updater"

local_key="$(read_env_value "$env_file" INSTACOMP_AI_API_KEY)"
port="${INSTACOMP_AI_PORT:-8787}"
readiness_file="$(mktemp -t instacomp-teacher-readiness.XXXXXX)"
trap 'rm -f "$gemini_response" "$groq_response" "$readiness_file"' EXIT
curl --fail --silent --show-error --max-time 20 \
  -H "X-InstaComp-AI-Key: $local_key" \
  "http://127.0.0.1:${port}/v1/training/readiness" \
  > "$readiness_file"
READINESS_FILE="$readiness_file" python3 - <<'PY'
import json
import os
import pathlib

payload = json.loads(pathlib.Path(os.environ["READINESS_FILE"]).read_text("utf-8"))
teacher = payload.get("teacher_comp_learning")
if not isinstance(teacher, dict):
    raise SystemExit("Updated Mac is reachable but teacher-comp learning readiness is missing.")
if teacher.get("pricing_authority") is not False:
    raise SystemExit("Teacher comp learner unexpectedly has pricing authority.")
print("PASS  Physical Mac exposes teacher-comp learning in student-only mode.")
PY

echo "InstaComp teacher bootstrap complete. Gemini + Groq are validated, the Mac is updated, Vercel Production is synchronized, and teacher-comp learning is ready."
