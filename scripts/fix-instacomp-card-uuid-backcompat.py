#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
storage = root / "services/instacomp-ai/app/storage.py"
models = root / "services/instacomp-ai/app/models.py"

source = storage.read_text(encoding="utf-8")
old = '''        scan_id: str,\n        card_uuid: str,\n        created_at: datetime,\n'''
new = '''        scan_id: str,\n        card_uuid: str | None = None,\n        created_at: datetime,\n'''
if new not in source:
    if source.count(old) != 1:
        raise SystemExit("save_scan card_uuid signature changed unexpectedly")
    source = source.replace(old, new, 1)

old = '''    ) -> None:\n        with self.connection() as db:\n            db.execute(\n                """\n                INSERT INTO scans (\n'''
new = '''    ) -> None:\n        resolved_card_uuid = str(card_uuid or scan_id).strip()\n        if not resolved_card_uuid:\n            raise ValueError("card_uuid or scan_id is required")\n        with self.connection() as db:\n            db.execute(\n                """\n                INSERT INTO scans (\n'''
if new not in source:
    if source.count(old) != 1:
        raise SystemExit("save_scan body changed unexpectedly")
    source = source.replace(old, new, 1)

old = '''                    scan_id,\n                    card_uuid,\n                    created_at.isoformat(),\n'''
new = '''                    scan_id,\n                    resolved_card_uuid,\n                    created_at.isoformat(),\n'''
if new not in source:
    if source.count(old) != 1:
        raise SystemExit("save_scan tuple changed unexpectedly")
    source = source.replace(old, new, 1)

old = '''            db.execute(\n                "CREATE INDEX IF NOT EXISTS scans_card_uuid_idx "\n                "ON scans(card_uuid)"\n            )\n'''
new = '''            db.execute(\n                "CREATE INDEX IF NOT EXISTS scans_card_uuid_idx "\n                "ON scans(card_uuid)"\n            )\n            # Legacy scans predate card_uuid. Their historical scan UUID is the\n            # safest permanent seed because no physical-card key existed yet.\n            db.execute("UPDATE scans SET card_uuid = scan_id WHERE card_uuid IS NULL")\n'''
if new not in source:
    if source.count(old) != 1:
        raise SystemExit("card_uuid index block changed unexpectedly")
    source = source.replace(old, new, 1)

storage.write_text(source, encoding="utf-8")

source = models.read_text(encoding="utf-8")
old = '''    card_uuid: str\n    created_at: datetime\n'''
new = '''    card_uuid: str | None = None\n    created_at: datetime\n'''
if new not in source:
    if source.count(old) != 1:
        raise SystemExit("AnalyzeResponse card_uuid field changed unexpectedly")
    source = source.replace(old, new, 1)
models.write_text(source, encoding="utf-8")
print("card UUID backwards compatibility applied")
