#!/usr/bin/env bash
set -euo pipefail

service_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python_bin="${1:-$service_root/.venv/bin/python}"
requirements="$service_root/requirements.txt"
marker="$service_root/.venv/.instacomp-requirements.sha256"
canonical_opencv_distribution="opencv-python-headless"
canonical_opencv_requirement="opencv-python-headless==4.12.0.88"

[[ -x "$python_bin" ]] || {
  echo "InstaComp runtime Python is missing: $python_bin" >&2
  exit 2
}
[[ -f "$requirements" ]] || {
  echo "InstaComp requirements file is missing: $requirements" >&2
  exit 2
}

if ! "$python_bin" - <<'PY' >/dev/null 2>&1
import sys
raise SystemExit(0 if (3, 11) <= sys.version_info[:2] <= (3, 13) else 1)
PY
then
  echo "InstaComp runtime Python must be 3.11, 3.12, or 3.13: $python_bin" >&2
  exit 2
fi

requirements_sha="$("$python_bin" - "$requirements" <<'PY'
from __future__ import annotations
import hashlib
import sys
from pathlib import Path
path = Path(sys.argv[1])
print(hashlib.sha256(path.read_bytes()).hexdigest())
PY
)"

installed_opencv_conflicts() {
  "$python_bin" - <<'PY'
from __future__ import annotations

import importlib.metadata as metadata

for distribution in (
    "opencv-python",
    "opencv-contrib-python",
    "opencv-contrib-python-headless",
):
    try:
        version = metadata.version(distribution)
    except metadata.PackageNotFoundError:
        continue
    print(f"{distribution}=={version}")
PY
}

verify_runtime() {
  "$python_bin" - "$requirements" <<'PY'
from __future__ import annotations

import importlib.metadata as metadata
import sys
from pathlib import Path

requirements = Path(sys.argv[1])
missing: list[str] = []
mismatched: list[str] = []

for raw in requirements.read_text(encoding="utf-8").splitlines():
    line = raw.split("#", 1)[0].strip()
    if not line or line.startswith(("-r", "--requirement")):
        continue
    if "==" not in line:
        raise SystemExit(f"Unpinned InstaComp runtime requirement is not allowed here: {line}")
    name, expected = line.split("==", 1)
    distribution = name.split("[", 1)[0].strip()
    expected = expected.strip()
    try:
        installed = metadata.version(distribution)
    except metadata.PackageNotFoundError:
        missing.append(distribution)
        continue
    if installed != expected:
        mismatched.append(f"{distribution}={installed} expected={expected}")

conflicting_opencv: list[str] = []
for distribution in (
    "opencv-python",
    "opencv-contrib-python",
    "opencv-contrib-python-headless",
):
    try:
        version = metadata.version(distribution)
    except metadata.PackageNotFoundError:
        continue
    conflicting_opencv.append(f"{distribution}={version}")

if missing or mismatched or conflicting_opencv:
    details = [
        *(f"missing:{value}" for value in missing),
        *mismatched,
        *(f"conflicting-opencv:{value}" for value in conflicting_opencv),
    ]
    print("; ".join(details), file=sys.stderr)
    raise SystemExit(1)

import cv2
import numpy

if cv2.__version__ != "4.12.0":
    raise SystemExit(f"cv2 runtime mismatch: {cv2.__version__} expected 4.12.0")
if numpy.__version__ != "2.2.6":
    raise SystemExit(f"NumPy runtime mismatch: {numpy.__version__} expected 2.2.6")
PY
}

marker_sha=""
if [[ -f "$marker" ]]; then
  marker_sha="$(tr -d '[:space:]' < "$marker")"
fi

needs_sync=0
if [[ "$marker_sha" != "$requirements_sha" ]]; then
  needs_sync=1
elif ! verify_runtime >/dev/null 2>&1; then
  needs_sync=1
fi

if [[ "$needs_sync" == "1" ]]; then
  echo "Synchronizing InstaComp runtime dependencies to pinned requirements..."

  conflicts="$(installed_opencv_conflicts)"
  if [[ -n "$conflicts" ]]; then
    echo "Removing conflicting OpenCV distributions before restoring the canonical headless runtime..."
    while IFS= read -r conflict; do
      [[ -n "$conflict" ]] || continue
      distribution="${conflict%%==*}"
      echo "Removing $conflict"
      "$python_bin" -m pip uninstall -y "$distribution"
    done <<< "$conflicts"
  fi

  "$python_bin" -m pip install --disable-pip-version-check -r "$requirements"

  # OpenCV distributions share the same cv2 package namespace. If a stale
  # opencv-python/opencv-contrib wheel was ever installed alongside the pinned
  # headless wheel, uninstalling it can remove or leave behind cv2 files even
  # while opencv-python-headless metadata still reports the correct version.
  # Always restore the canonical wheel after any synchronization so the actual
  # importable cv2 package matches the distribution metadata.
  "$python_bin" -m pip install \
    --disable-pip-version-check \
    --force-reinstall \
    --no-deps \
    "$canonical_opencv_requirement"
fi

if ! verify_runtime; then
  echo "InstaComp runtime dependency verification failed after synchronization." >&2
  echo "Canonical OpenCV distribution must be $canonical_opencv_distribution with no competing cv2 provider installed." >&2
  exit 3
fi

mkdir -p "$(dirname "$marker")"
tmp_marker="${marker}.tmp.$$"
printf '%s\n' "$requirements_sha" > "$tmp_marker"
chmod 600 "$tmp_marker"
mv -f "$tmp_marker" "$marker"

"$python_bin" - "$requirements_sha" <<'PY'
import cv2
import numpy
import platform
import sys

print(
    "PASS InstaComp runtime dependencies synchronized "
    f"Python={sys.version.split()[0]} "
    f"platform={platform.machine()} "
    f"OpenCV={cv2.__version__} "
    f"NumPy={numpy.__version__} "
    f"requirements_sha256={sys.argv[1]}"
)
PY
