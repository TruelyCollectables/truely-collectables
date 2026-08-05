from __future__ import annotations

import json
from pathlib import Path

from app.config import settings
from app.system_doctor import SystemDoctor


def main() -> int:
    report = SystemDoctor(settings).run()
    receipt_dir = settings.service_root / "data" / "receipts" / "system-doctor"
    receipt_dir.mkdir(parents=True, exist_ok=True)
    receipt_path = receipt_dir / "latest.json"
    receipt_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"\nSystem Doctor receipt: {receipt_path}")
    return 0 if report["ready"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
