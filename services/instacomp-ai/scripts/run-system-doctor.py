from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from app.checklist import checklist_gateway
from app.config import settings
from app.main import reader, store
from app.system_doctor import run_system_doctor


async def main() -> int:
    report = await run_system_doctor(
        settings,
        store,
        reader,
        checklist_gateway,
    )
    receipt_root = settings.service_root / "data" / "receipts" / "system-doctor"
    receipt_root.mkdir(parents=True, exist_ok=True)
    latest = receipt_root / "latest.json"
    temporary = latest.with_suffix(".json.partial")
    temporary.write_text(json.dumps(report, indent=2), encoding="utf-8")
    os.replace(temporary, latest)
    print(json.dumps(report, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
