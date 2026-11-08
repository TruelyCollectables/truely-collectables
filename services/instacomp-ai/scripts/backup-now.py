from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.backup import BackupManager
from app.config import settings


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a complete InstaComp AI local backup in an approved root.",
    )
    parser.add_argument("--destination", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = BackupManager(settings).create(
        str(args.destination) if args.destination else None
    )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
