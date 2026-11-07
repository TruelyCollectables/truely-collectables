#!/usr/bin/env python3
from pathlib import Path

path = Path("services/instacomp-ai/app/ollama.py")
source = path.read_text(encoding="utf-8")

marker = '''def normalize_identity_payload(payload: dict) -> dict:\n    identity = dict(payload.get("identity") or {})\n'''
replacement = '''def normalize_identity_payload(payload: dict) -> dict:\n    identity = dict(payload.get("identity") or {})\n    # Vision models frequently emit visible numeric fields such as year and\n    # card number as JSON numbers. CardIdentity intentionally stores these as\n    # strings, so normalize them before Pydantic validation instead of\n    # misclassifying a valid model answer as model_unavailable.\n    for field in [\n        "sport",\n        "league",\n        "year",\n        "manufacturer",\n        "brand",\n        "set_name",\n        "subset",\n        "player",\n        "team",\n        "card_number",\n        "parallel",\n        "variation",\n        "serial_number",\n        "inscription_text",\n        "memorabilia_type",\n    ]:\n        value = identity.get(field)\n        identity[field] = str(value).strip() or None if value is not None else None\n'''

if replacement in source:
    print(f"already patched {path}")
    raise SystemExit(0)

count = source.count(marker)
if count != 1:
    raise SystemExit(f"Expected one normalize_identity_payload marker, found {count}")

source = source.replace(marker, replacement, 1)
path.write_text(source, encoding="utf-8")
print(f"patched {path}")
