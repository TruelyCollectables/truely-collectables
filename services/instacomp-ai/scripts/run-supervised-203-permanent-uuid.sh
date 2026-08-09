#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This trusted 203-card UUID import is only allowed on the InstaComp Mac runtime." >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
service_root="$(cd "$script_dir/.." && pwd)"
repo_root="$(git -C "$service_root" rev-parse --show-toplevel 2>/dev/null || true)"
expected_service_root="$repo_root/services/instacomp-ai"
required_uuid_commit="be682137a371c02f716a6b26d469baee29dc8fe7"
expected_archive_sha="621d58db6fe31e15d462a72b649e66a8d742639ce39973570e790bae6d11081a"

if [[ -z "$repo_root" || "$service_root" != "$expected_service_root" ]]; then
  echo "Refusing import: InstaComp is not running from the expected repository layout." >&2
  exit 2
fi
if [[ "$(git -C "$repo_root" branch --show-current)" != "main" ]]; then
  echo "Refusing import: the live InstaComp checkout must be on main." >&2
  exit 2
fi
if [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=no)" ]]; then
  echo "Refusing import: tracked working-tree changes are present." >&2
  git -C "$repo_root" status --short --untracked-files=no >&2
  exit 2
fi
if ! git -C "$repo_root" merge-base --is-ancestor "$required_uuid_commit" HEAD; then
  echo "Refusing import: the permanent UUID legacy migration is not installed yet." >&2
  echo "Run services/instacomp-ai/scripts/update-live-from-main.sh first." >&2
  exit 2
fi

python_bin="$service_root/.venv/bin/python"
if [[ ! -x "$python_bin" ]]; then
  echo "Refusing import: InstaComp Python runtime is missing. Run update-live-from-main.sh first." >&2
  exit 2
fi

sha256_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

archive="${1:-}"
if [[ -n "$archive" ]]; then
  archive="$(cd "$(dirname "$archive")" && pwd)/$(basename "$archive")"
  [[ -f "$archive" ]] || {
    echo "Scan archive not found: $archive" >&2
    exit 2
  }
else
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
    echo "Could not find the reviewed 203-card 'All scans.zip' automatically." >&2
    echo "Pass its full path as the first argument. The required SHA-256 is:" >&2
    echo "$expected_archive_sha" >&2
    exit 2
  }
fi

actual_archive_sha="$(sha256_file "$archive")"
if [[ "$actual_archive_sha" != "$expected_archive_sha" ]]; then
  echo "Refusing import: scan archive SHA-256 does not match the reviewed 203-card source." >&2
  echo "Expected: $expected_archive_sha" >&2
  echo "Actual:   $actual_archive_sha" >&2
  exit 2
fi

data_dir="$service_root/data/supervised-203"
truth_path="$data_dir/operator-truth-203.json"
uuid_map_path="$data_dir/card-uuid-map.json"
receipt_path="$data_dir/trusted-import-receipt.json"
mkdir -p "$data_dir"

"$python_bin" - "$repo_root/scripts/fixtures/instacomp-supervised-203" "$truth_path" <<'PY'
import json
import pathlib
import sys

fixture_dir = pathlib.Path(sys.argv[1])
out = pathlib.Path(sys.argv[2])
cards = []
for path in sorted(fixture_dir.glob("cards-*.json")):
    payload = json.loads(path.read_text("utf-8"))
    rows = payload.get("cards") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise SystemExit(f"Invalid supervised fixture: {path}")
    cards.extend(rows)
cards.sort(key=lambda row: int(row.get("o") or 0))
if len(cards) != 203:
    raise SystemExit(f"Expected 203 supervised cards, found {len(cards)}")
for ordinal, card in enumerate(cards, start=1):
    expected = f"SCAN-{ordinal:04d}"
    if int(card.get("o") or 0) != ordinal or card.get("s") != expected:
        raise SystemExit(f"Supervised truth sequence mismatch at {ordinal}: {card.get('s')!r}")
    if str(card.get("n") or "").strip().lower() == "base":
        # Structural Base remains internal truth only. It is never a display-title suffix.
        pass
payload = {
    "schema": "tcos.instacomp-ai.supervised-203-operator-truth.v1",
    "count": len(cards),
    "cards": cards,
}
temp = out.with_suffix(out.suffix + ".tmp")
temp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
temp.replace(out)
print(f"Prepared {len(cards)} operator-confirmed card truths: {out}")
PY

importer="$service_root/scripts/import_supervised_203_trusted.py"
echo "Verifying reviewed archive + 203-card truth before any mutation..."
"$python_bin" "$importer" \
  --archive "$archive" \
  --truth "$truth_path" \
  --service-root "$service_root" \
  --verify-only

args=(
  --archive "$archive"
  --truth "$truth_path"
  --service-root "$service_root"
)
if [[ "${INSTACOMP_SUPERVISED_203_SKIP_LORA:-0}" != "1" ]]; then
  args+=(--train-lora)
fi

echo "Importing all 203 operator-confirmed cards with permanent physical card UUIDs..."
"$python_bin" "$importer" "${args[@]}"

"$python_bin" - "$uuid_map_path" "$receipt_path" <<'PY'
import json
import pathlib
import sys
import uuid

uuid_map_path = pathlib.Path(sys.argv[1])
receipt_path = pathlib.Path(sys.argv[2])
if not uuid_map_path.is_file() or not receipt_path.is_file():
    raise SystemExit("Trusted import did not produce the UUID map and receipt.")
uuid_map = json.loads(uuid_map_path.read_text("utf-8"))
receipt = json.loads(receipt_path.read_text("utf-8"))
cards = uuid_map.get("cards") if isinstance(uuid_map, dict) else None
if not isinstance(cards, list) or len(cards) != 203:
    raise SystemExit("Permanent card UUID map does not contain exactly 203 cards.")
seen = set()
for ordinal, row in enumerate(cards, start=1):
    if int(row.get("ordinal") or 0) != ordinal:
        raise SystemExit(f"UUID map ordinal mismatch at {ordinal}.")
    value = str(uuid.UUID(str(row.get("cardUuid") or "")))
    if value in seen:
        raise SystemExit(f"Duplicate permanent physical card UUID: {value}")
    seen.add(value)
summary = receipt.get("summary") if isinstance(receipt, dict) else {}
if summary.get("ok") is not True or int(summary.get("trustedVerified") or 0) != 203:
    raise SystemExit("Trusted receipt does not verify all 203 cards.")
if int(summary.get("uniquePermanentCardUuids") or 0) != 203:
    raise SystemExit("Trusted receipt does not verify 203 unique permanent card UUIDs.")
print(json.dumps({
    "ok": True,
    "trustedVerified": 203,
    "uniquePermanentCardUuids": 203,
    "uuidMap": str(uuid_map_path),
    "receipt": str(receipt_path),
    "training": summary.get("trainingReadiness"),
    "trainingExport": summary.get("trainingExport"),
}, indent=2))
PY

echo "PASS: all 203 physical cards have unique permanent UUIDs and trusted operator truth."
echo "UUID map: $uuid_map_path"
echo "Receipt:  $receipt_path"
