#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
service_root="$(cd "$script_dir/.." && pwd)"
repo_root="$(git -C "$service_root" rev-parse --show-toplevel 2>/dev/null || true)"
python_bin="$service_root/.venv/bin/python"
expected_sha="621d58db6fe31e15d462a72b649e66a8d742639ce39973570e790bae6d11081a"
expected_size="79948156"

if [[ ! -x "$python_bin" ]]; then
  echo "InstaComp Python runtime is missing: $python_bin" >&2
  exit 2
fi

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
