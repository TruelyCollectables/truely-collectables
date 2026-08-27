#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
service_root="$(cd "$script_dir/.." && pwd)"
repo_root="$(git -C "$service_root" rev-parse --show-toplevel 2>/dev/null || true)"
python_bin="$service_root/.venv/bin/python"
expected_sha="621d58db6fe31e15d462a72b649e66a8d742639ce39973570e790bae6d11081a"
expected_size="79948156"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This supervised 203-card run is only allowed on the InstaComp Mac." >&2
  exit 2
fi
if [[ ! -x "$python_bin" ]]; then
  echo "InstaComp Python runtime is missing: $python_bin" >&2
  exit 2
fi
if [[ -z "$repo_root" || "$(git -C "$repo_root" branch --show-current)" != "main" ]]; then
  echo "The live InstaComp checkout must be on main before this import." >&2
  exit 2
fi
if [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=no)" ]]; then
  echo "Tracked working-tree changes are present; refusing to restart/import." >&2
  git -C "$repo_root" status --short --untracked-files=no >&2
  exit 2
fi

# The importer talks to the running FastAPI process. A git pull alone does not
# reload Python modules, so restart the LaunchAgent before any card mutation.
label="${INSTACOMP_AI_LAUNCHD_LABEL:-com.truelycollectables.instacomp-ai}"
domain="gui/$(id -u)"
echo "Restarting local InstaComp service from current main..."
if ! launchctl kickstart -k "${domain}/${label}"; then
  echo "Could not restart ${label}. Reinstall/restart InstaComp before importing." >&2
  exit 2
fi

port="$(cd "$service_root" && "$python_bin" - <<'PY'
from app.config import settings
print(settings.port)
PY
)"
api_key="$(cd "$service_root" && "$python_bin" - <<'PY'
from app.config import settings
print(settings.api_key)
PY
)"
if [[ -z "$port" || ${#api_key} -ne 64 ]]; then
  echo "Local InstaComp port/API key could not be loaded from current settings." >&2
  exit 2
fi

# Fail closed until the restarted process proves the exact readback URL that
# previously returned HTTP 422 is live and accepts limit=5000.
echo "Preflighting live trusted-readback endpoint (limit=5000) before card mutation..."
"$python_bin" - "$port" "$api_key" <<'PY'
import json
import sys
import time

import httpx

port = sys.argv[1]
api_key = sys.argv[2]
base = f"http://127.0.0.1:{port}"
headers = {"X-InstaComp-AI-Key": api_key, "Accept": "application/json"}
last_error = "service did not answer"
for _ in range(60):
    try:
        health = httpx.get(f"{base}/health", timeout=2.0)
        if health.status_code == 200:
            response = httpx.get(
                f"{base}/v1/training/examples?trusted_only=true&limit=5000",
                headers=headers,
                timeout=20.0,
            )
            if response.status_code != 200:
                print(
                    "REFUSING IMPORT: trusted-readback preflight returned "
                    f"HTTP {response.status_code}: {response.text[:800]}",
                    file=sys.stderr,
                )
                raise SystemExit(3)
            payload = response.json()
            if payload.get("schema_version") != "tcos.instacomp-ai.training-examples.v1":
                print(
                    "REFUSING IMPORT: trusted-readback endpoint returned the wrong schema.",
                    file=sys.stderr,
                )
                raise SystemExit(3)
            print(
                "PASS live trusted-readback preflight: "
                f"HTTP 200, current trusted rows={payload.get('count', 0)}"
            )
            raise SystemExit(0)
        last_error = f"health HTTP {health.status_code}"
    except (httpx.HTTPError, ValueError, json.JSONDecodeError) as exc:
        last_error = f"{type(exc).__name__}: {exc}"
    time.sleep(1)
print(f"REFUSING IMPORT: restarted InstaComp never became ready: {last_error}", file=sys.stderr)
raise SystemExit(3)
PY

requested="${1:-$HOME/Downloads/All scans.zip}"
requested_parent="$(dirname "$requested")"

archive="$("$python_bin" - "$HOME" "$PWD" "$repo_root" "$requested_parent" "$expected_sha" "$expected_size" <<'PY'
import hashlib
import pathlib
import sys

home = pathlib.Path(sys.argv[1]).expanduser()
pwd = pathlib.Path(sys.argv[2]).expanduser()
repo = pathlib.Path(sys.argv[3]).expanduser() if sys.argv[3] else pwd
requested_parent = pathlib.Path(sys.argv[4]).expanduser()
expected_sha = sys.argv[5].lower()
expected_size = int(sys.argv[6])

roots = [
    requested_parent,
    home / "Downloads",
    pwd,
    repo,
    home / "Desktop",
    home / "Documents",
]

print(
    f"Finding reviewed 203-card ZIP by exact size ({expected_size:,} bytes) + SHA-256...",
    file=sys.stderr,
)

candidates = []
seen_roots = set()
for root in roots:
    try:
        root = root.resolve()
    except OSError:
        continue
    key = str(root)
    if key in seen_roots or not root.is_dir():
        continue
    seen_roots.add(key)
    try:
        entries = list(root.iterdir())
    except OSError:
        continue
    for path in entries:
        try:
            if path.is_file() and path.suffix.lower() == ".zip":
                candidates.append(path)
            elif path.is_dir() and root in {home / "Downloads", home / "Desktop", home / "Documents"}:
                # One level below only. Never recurse the filesystem.
                try:
                    for child in path.iterdir():
                        if child.is_file() and child.suffix.lower() == ".zip":
                            candidates.append(child)
                except OSError:
                    pass
        except OSError:
            pass

seen = set()
for path in candidates:
    try:
        resolved = path.resolve()
        key = str(resolved)
        if key in seen or not resolved.is_file():
            continue
        seen.add(key)
        if resolved.stat().st_size != expected_size:
            continue
        digest = hashlib.sha256()
        with resolved.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest().lower() == expected_sha:
            print(resolved)
            raise SystemExit(0)
    except OSError:
        continue

print("Reviewed ZIP was not found in the bounded locations.", file=sys.stderr)
print("Direct ZIP files seen:", file=sys.stderr)
for path in candidates[:100]:
    try:
        print(f"  {path}  ({path.stat().st_size:,} bytes)", file=sys.stderr)
    except OSError:
        pass
raise SystemExit(3)
PY
)"

if [[ -z "$archive" ]]; then
  exit 3
fi

echo "Found exact reviewed archive: $archive"
exec bash "$script_dir/run-supervised-203-permanent-uuid.sh" "$archive"
