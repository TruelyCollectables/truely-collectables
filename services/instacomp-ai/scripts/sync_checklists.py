from __future__ import annotations

import fcntl
import hashlib
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.config import settings
from app.registry import RegistryBuilder

SUPPORTED_SUFFIXES = {".csv", ".xlsx", ".xlsm", ".json", ".pdf", ".txt"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".partial")
    temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def main() -> int:
    service_root = settings.service_root
    source = settings.resolved_checklist_source()
    if source is None:
        print("INSTACOMP_AI_CHECKLIST_SOURCE_PATH is not configured", file=sys.stderr)
        return 2
    if not source.is_dir():
        print(f"Checklist source does not exist: {source}", file=sys.stderr)
        return 2

    mirror_root = settings.resolve_local_path(settings.checklist_mirror_path)
    receipts_root = service_root / "data" / "receipts" / "checklist-sync"
    quarantine_root = service_root / "data" / "quarantine" / "checklists"
    registry_path = settings.resolve_local_path(settings.registry_path)
    lock_root = service_root / "data" / "locks"
    mirror_root.mkdir(parents=True, exist_ok=True)
    receipts_root.mkdir(parents=True, exist_ok=True)
    quarantine_root.mkdir(parents=True, exist_ok=True)
    lock_root.mkdir(parents=True, exist_ok=True)

    try:
        mirror_root.relative_to(source)
    except ValueError:
        pass
    else:
        print(
            "Checklist source cannot contain the local mirror folder; choose the Google Drive source folder instead.",
            file=sys.stderr,
        )
        return 2

    lock_path = lock_root / "checklist-sync.lock"
    with lock_path.open("w", encoding="utf-8") as lock_handle:
        try:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Checklist sync is already running", file=sys.stderr)
            return 4
        lock_handle.write(f"pid={os.getpid()} started={datetime.now(timezone.utc).isoformat()}\n")
        lock_handle.flush()
        return _run_locked_sync(
            source=source,
            mirror_root=mirror_root,
            receipts_root=receipts_root,
            quarantine_root=quarantine_root,
            registry_path=registry_path,
        )


def _run_locked_sync(
    *,
    source: Path,
    mirror_root: Path,
    receipts_root: Path,
    quarantine_root: Path,
    registry_path: Path,
) -> int:
    previous_inventory_path = receipts_root / "latest-inventory.json"
    previous_inventory = {}
    if previous_inventory_path.exists():
        try:
            previous_inventory = json.loads(
                previous_inventory_path.read_text(encoding="utf-8")
            ).get("files", {})
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
        stat_result = path.stat()
        key = relative.as_posix()
        inventory[key] = {
            "sha256": fingerprint,
            "size_bytes": stat_result.st_size,
            "modified_ns": stat_result.st_mtime_ns,
        }
        destination = mirror_root / relative
        prior = previous_inventory.get(key, {})
        if prior.get("sha256") == fingerprint and destination.exists():
            unchanged += 1
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".partial")
        shutil.copy2(path, temporary)
        if sha256(temporary) != fingerprint:
            temporary.unlink(missing_ok=True)
            raise RuntimeError(f"Checksum mismatch while copying {relative}")
        os.replace(temporary, destination)
        copied += 1

    removed = sorted(set(previous_inventory) - set(inventory))
    for key in removed:
        target = mirror_root / key
        target.unlink(missing_ok=True)
        _remove_empty_parents(target.parent, mirror_root)

    registry_receipt = RegistryBuilder(
        mirror_root=mirror_root,
        registry_path=registry_path,
        quarantine_root=quarantine_root,
    ).build()

    now = datetime.now(timezone.utc)
    receipt: dict[str, object] = {
        "schema": "tcos.instacomp-ai.checklist-folder-sync.v3",
        "created_at": now.isoformat(),
        "source": str(source),
        "mirror": str(mirror_root),
        "files_seen": len(inventory),
        "files_copied_or_updated": copied,
        "files_unchanged": unchanged,
        "files_removed": len(removed),
        "unsupported_files_skipped": skipped,
        "registry": registry_receipt,
        "files": inventory,
    }
    timestamp = now.strftime("%Y%m%dT%H%M%SZ")
    receipt_path = receipts_root / f"sync-{timestamp}.json"
    atomic_json(receipt_path, receipt)
    atomic_json(previous_inventory_path, receipt)
    print(
        json.dumps(
            {key: value for key, value in receipt.items() if key != "files"},
            indent=2,
        )
    )
    return 0 if registry_receipt["activated"] else 3


def _remove_empty_parents(path: Path, stop: Path) -> None:
    current = path
    while current != stop:
        try:
            current.rmdir()
        except OSError:
            return
        current = current.parent


if __name__ == "__main__":
    raise SystemExit(main())
