#!/usr/bin/env python3
from pathlib import Path

path = Path("services/instacomp-ai/scripts/run-supervised-203-permanent-uuid.sh")
source = path.read_text(encoding="utf-8")
old = '''else
  candidates=(
    "$HOME/Downloads/All scans.zip"
    "$HOME/Desktop/All scans.zip"
    "$HOME/Documents/All scans.zip"
    "$service_root/data/supervised-203/All scans.zip"
    "$repo_root/All scans.zip"
  )
  while IFS= read -r candidate; do
    candidates+=("$candidate")
  done < <(
    find "$HOME/Downloads" "$HOME/Desktop" "$HOME/Documents" \\
      -maxdepth 2 -type f \\( -iname 'All scans.zip' -o -iname '*scans*.zip' \\) \\
      2>/dev/null || true
  )
  declare -A seen=()
  for candidate in "${candidates[@]}"; do
    [[ -f "$candidate" ]] || continue
    [[ -z "${seen[$candidate]:-}" ]] || continue
    seen[$candidate]=1
    if [[ "$(sha256_file "$candidate")" == "$expected_archive_sha" ]]; then
      archive="$candidate"
      break
    fi
  done
  [[ -n "$archive" ]] || {
'''
new = '''else
  # macOS still ships Bash 3.2. Keep archive discovery in Python so the
  # physical Mac does not depend on newer shell-only collection features or
  # GNU-only find depth flags.
  archive="$("$python_bin" - "$HOME" "$service_root" "$repo_root" "$expected_archive_sha" <<'PY'
import hashlib
import pathlib
import sys

home = pathlib.Path(sys.argv[1]).expanduser()
service_root = pathlib.Path(sys.argv[2])
repo_root = pathlib.Path(sys.argv[3])
expected = sys.argv[4].lower()

candidates = [
    home / "Downloads" / "All scans.zip",
    home / "Desktop" / "All scans.zip",
    home / "Documents" / "All scans.zip",
    service_root / "data" / "supervised-203" / "All scans.zip",
    repo_root / "All scans.zip",
]
for root in (home / "Downloads", home / "Desktop", home / "Documents"):
    if not root.is_dir():
        continue
    for path in root.rglob("*.zip"):
        try:
            relative = path.relative_to(root)
        except ValueError:
            continue
        if len(relative.parts) > 3:
            continue
        name = path.name.lower()
        if name == "all scans.zip" or "scans" in name:
            candidates.append(path)

seen = set()
for path in candidates:
    try:
        resolved = path.expanduser().resolve()
    except OSError:
        continue
    key = str(resolved)
    if key in seen or not resolved.is_file():
        continue
    seen.add(key)
    digest = hashlib.sha256()
    try:
        with resolved.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError:
        continue
    if digest.hexdigest().lower() == expected:
        print(resolved)
        raise SystemExit(0)
raise SystemExit(0)
PY
)"
  [[ -n "$archive" ]] || {
'''
if new in source:
    print("macOS Bash 3.2 archive discovery already patched")
elif source.count(old) == 1:
    path.write_text(source.replace(old, new, 1), encoding="utf-8")
    print("patched supervised 203 archive discovery for macOS Bash 3.2")
else:
    raise SystemExit(f"expected one legacy archive-discovery block, found {source.count(old)}")
