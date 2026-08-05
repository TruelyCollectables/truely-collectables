from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

SUPPORTED_SUFFIXES = {".csv", ".xlsx", ".xls", ".json", ".pdf", ".txt"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    service_root = Path(__file__).resolve().parents[1]
    source_value = os.environ.get("INSTACOMP_AI_CHECKLIST_SOURCE_PATH", "").strip()
    if not source_value:
        print("INSTACOMP_AI_CHECKLIST_SOURCE_PATH is not configured", file=sys.stderr)
        return 2

    source = Path(source_value).expanduser().resolve()
    if not source.is_dir():
        print(f"Checklist source does not exist: {source}", file=sys.stderr)
        return 2

    mirror_root = service_root / "data" / "checklists" / "mirror"
    receipts_root = service_root / "data" / "receipts" / "checklist-sync"
    mirror_root.mkdir(parents=True, exist_ok=True)
    receipts_root.mkdir(parents=True, exist_ok=True)

    previous_inventory_path = receipts_root / "latest-inventory.json"
    previous_inventory = {}
    if previous_inventory_path.exists():
        try:
            previous_inventory = json.loads(previous_inventory_path.read_text(encoding="utf-8")).get("files", {})
        except (OSError, json.JSONDecodeError):
            previous_inventory = {}

    inventory: dict[str, dict[str, object]] = {}
    copied = 0
    unchanged = 0
    skipped = 0

    for path in sorted(item for item in source.rglob("*") if item.is_file()):
        if path.name.startswith(".") or path.suffix.lower() not in SUPPORTED_SUFFIXES:
            skipped += 1
            continue
        relative = path.relative_to(source)
        fingerprint = sha256(path)
        stat = path.stat()
        key = relative.as_posix()
        inventory[key] = {
            "sha256": fingerprint,
            "size_bytes": stat.st_size,
            "modified_ns": stat.st_mtime_ns,
        }
        destination = mirror_root / relative
        prior = previous_inventory.get(key, {})
        if prior.get("sha256") == fingerprint and destination.exists():
            unchanged += 1
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        temp = destination.with_suffix(destination.suffix + ".partial")
        shutil.copy2(path, temp)
        if sha256(temp) != fingerprint:
            temp.unlink(missing_ok=True)
            raise RuntimeError(f"Checksum mismatch while copying {relative}")
        os.replace(temp, destination)
        copied += 1

    removed = sorted(set(previous_inventory) - set(inventory))
    for key in removed:
        target = mirror_root / key
        target.unlink(missing_ok=True)

    now = datetime.now(timezone.utc)
    receipt = {
        "schema": "tcos.instacomp-ai.checklist-folder-sync.v1",
        "created_at": now.isoformat(),
        "source": str(source),
        "mirror": str(mirror_root),
        "files_seen": len(inventory),
        "files_copied_or_updated": copied,
        "files_unchanged": unchanged,
        "files_removed": len(removed),
        "unsupported_files_skipped": skipped,
        "files": inventory,
    }
    timestamp = now.strftime("%Y%m%dT%H%M%SZ")
    receipt_path = receipts_root / f"sync-{timestamp}.json"
    receipt_path.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    previous_inventory_path.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in receipt.items() if key != "files"}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
