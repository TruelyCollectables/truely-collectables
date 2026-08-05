#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.backup import FullBackupManager  # noqa: E402
from app.config import settings  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a full InstaComp AI disaster-recovery ZIP.")
    parser.add_argument("--destination", default=str(settings.backup_default_destination))
    parser.add_argument("--label", default=None)
    args = parser.parse_args()

    settings.ensure_directories()
    result = FullBackupManager(settings.service_root, settings.database_path).create(
        Path(args.destination), args.label
    )
    print(json.dumps({
        "ok": True,
        "archive_path": str(result.archive_path),
        "checksum_path": str(result.checksum_path),
        "manifest_path": str(result.manifest_path),
        "sha256": result.sha256,
        "size_bytes": result.size_bytes,
        "file_count": result.file_count,
        "created_at": result.created_at.isoformat(),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
