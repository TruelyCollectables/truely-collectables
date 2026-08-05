from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_members(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    members = archive.infolist()
    for member in members:
        path = Path(member.filename)
        if path.is_absolute() or ".." in path.parts:
            raise RuntimeError(f"Unsafe archive member: {member.filename}")
    return members


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify or restore a full InstaComp AI backup")
    parser.add_argument("archive", type=Path)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--apply", action="store_true", help="Actually replace the destination folder")
    args = parser.parse_args()

    archive_path = args.archive.expanduser().resolve()
    if not archive_path.is_file():
        raise SystemExit(f"Backup not found: {archive_path}")

    checksum_path = Path(str(archive_path) + ".sha256")
    if checksum_path.exists():
        expected = checksum_path.read_text(encoding="utf-8").split()[0]
        actual = sha256(archive_path)
        if expected != actual:
            raise SystemExit("Backup checksum does not match")

    with tempfile.TemporaryDirectory(prefix="instacomp-ai-restore-") as temp:
        staging = Path(temp)
        with zipfile.ZipFile(archive_path) as archive:
            members = safe_members(archive)
            archive.extractall(staging, members)
        roots = [path for path in staging.iterdir() if path.is_dir()]
        if len(roots) != 1:
            raise SystemExit("Backup must contain exactly one InstaComp AI root folder")
        restored_root = roots[0]
        manifest_path = restored_root / "BACKUP-MANIFEST.json"
        if not manifest_path.exists():
            raise SystemExit("Backup manifest is missing")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for record in manifest.get("files", []):
            path = restored_root / record["path"]
            if not path.is_file() or sha256(path) != record["sha256"]:
                raise SystemExit(f"Backup file verification failed: {record['path']}")

        print(json.dumps({
            "verified": True,
            "archive": str(archive_path),
            "file_count": manifest.get("file_count"),
            "created_at": manifest.get("created_at"),
        }, indent=2))

        if not args.apply:
            print("Verification complete. Re-run with --destination and --apply to restore.")
            return 0
        if not args.destination:
            raise SystemExit("--destination is required with --apply")

        destination = args.destination.expanduser().resolve()
        if destination.exists() and any(destination.iterdir()):
            emergency = destination.parent / f"{destination.name}.before-restore"
            if emergency.exists():
                raise SystemExit(f"Emergency pre-restore folder already exists: {emergency}")
            shutil.move(str(destination), str(emergency))
            print(f"Existing installation moved to: {emergency}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(restored_root, destination, dirs_exist_ok=False)
        print(f"Restored InstaComp AI to: {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
