from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_manifest(archive: Path) -> dict[str, Any] | None:
    path = archive.with_suffix(".zip.manifest.json")
    if not path.is_file():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Backup manifest must be a JSON object")
    return payload


def read_sidecar_digest(archive: Path) -> str | None:
    path = archive.with_suffix(".zip.sha256")
    if not path.is_file():
        return None
    token = path.read_text(encoding="utf-8").strip().split()[0]
    if len(token) != 64 or any(character not in "0123456789abcdefABCDEF" for character in token):
        raise ValueError("Backup SHA-256 sidecar is invalid")
    return token.lower()


def validate_member(info: zipfile.ZipInfo) -> None:
    name = PurePosixPath(info.filename)
    if name.is_absolute() or ".." in name.parts:
        raise ValueError(f"Unsafe archive path: {info.filename}")
    unix_mode = info.external_attr >> 16
    if stat.S_ISLNK(unix_mode):
        raise ValueError(f"Symbolic links are not permitted in restores: {info.filename}")


def inspect_archive(
    archive: Path,
    expected_digest: str | None = None,
) -> dict[str, Any]:
    if not archive.is_file() or not zipfile.is_zipfile(archive):
        raise ValueError("Backup archive is missing or is not a valid ZIP file")

    actual_digest = sha256(archive)
    manifest = read_manifest(archive)
    sidecar_digest = read_sidecar_digest(archive)
    claims = [
        value.lower()
        for value in [
            expected_digest,
            sidecar_digest,
            str(manifest.get("archive_sha256") or "") if manifest else None,
        ]
        if value
    ]
    if claims and any(value != actual_digest for value in claims):
        raise ValueError("Backup SHA-256 verification failed")

    with zipfile.ZipFile(archive) as source:
        files = [info for info in source.infolist() if not info.is_dir()]
        for info in source.infolist():
            validate_member(info)

    expected_files = int(manifest.get("file_count") or 0) if manifest else 0
    if expected_files and expected_files != len(files):
        raise ValueError("Backup manifest file count does not match the archive")

    return {
        "schema": "tcos.instacomp-ai.restore-verification.v2",
        "verified_at": datetime.now(timezone.utc).isoformat(),
        "archive_name": archive.name,
        "archive_sha256": actual_digest,
        "file_count": len(files),
        "manifest_present": manifest is not None,
        "sha256_sidecar_present": sidecar_digest is not None,
        "canonical_identity_authority": "central_checklist_registry",
        "local_cache_is_authoritative": False,
    }


def restore_archive(archive: Path, destination: Path, verification: dict[str, Any]) -> Path:
    destination = destination.expanduser().resolve()
    if destination.exists():
        raise ValueError("Restore destination must not already exist")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not os.access(destination.parent, os.R_OK | os.W_OK):
        raise ValueError("Restore destination parent is not readable and writable")

    staging = Path(
        tempfile.mkdtemp(
            prefix=f".{destination.name}.restore-",
            dir=destination.parent,
        )
    )
    try:
        with zipfile.ZipFile(archive) as source:
            for info in source.infolist():
                validate_member(info)
                source.extract(info, staging)
        os.replace(staging, destination)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise

    receipt = {
        **verification,
        "schema": "tcos.instacomp-ai.restore-receipt.v2",
        "restored_at": datetime.now(timezone.utc).isoformat(),
        "destination": str(destination),
        "overwrite_performed": False,
    }
    receipt_path = destination.parent / f"{destination.name}.restore-receipt.json"
    temporary = receipt_path.with_suffix(receipt_path.suffix + ".partial")
    temporary.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    os.replace(temporary, receipt_path)
    return receipt_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Verify or safely restore a complete InstaComp AI local backup.",
    )
    parser.add_argument("archive", type=Path)
    parser.add_argument("--expected-sha256")
    parser.add_argument("--destination", type=Path)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Perform a no-overwrite restore. The default is verification only.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    archive = args.archive.expanduser().resolve()
    verification = inspect_archive(archive, args.expected_sha256)
    if args.apply:
        if args.destination is None:
            raise SystemExit("--destination is required with --apply")
        receipt_path = restore_archive(archive, args.destination, verification)
        verification = {**verification, "restore_receipt": str(receipt_path)}
    print(json.dumps(verification, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
