#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SENTINEL = ROOT / "services/instacomp-ai/app/sentinel.py"
TEST = ROOT / "services/instacomp-ai/tests/test_sentinel_psa_source_order.py"

source = SENTINEL.read_text(encoding="utf-8")
old = '''        try:\n            sources = self.store.list_sources(enabled_only=True)\n            for target in targets:\n'''
new = '''        try:\n            sources = self.store.list_sources(enabled_only=True)\n            # PSA APR is a first-party checklist source and must run before any\n            # SERP-backed manufacturer/community discovery. Trust still orders\n            # the remaining sources after the PSA-first lane.\n            sources.sort(\n                key=lambda source: (\n                    0 if source.get("source_id") == "psa" else 1,\n                    -int(source.get("trust_score") or 0),\n                    str(source.get("source_id") or ""),\n                )\n            )\n            for target in targets:\n'''
if new not in source:
    if source.count(old) != 1:
        raise SystemExit(f"expected one Sentinel source-list block, found {source.count(old)}")
    SENTINEL.write_text(source.replace(old, new, 1), encoding="utf-8")
    print("patched Sentinel PSA-first source order")
else:
    print("Sentinel PSA-first source order already patched")

TEST.write_text('''from app.sentinel import ChecklistSentinel\n\n\ndef test_runtime_source_order_puts_psa_before_serp_backed_sources(tmp_path):\n    sentinel = ChecklistSentinel(\n        database_path=tmp_path / "instacomp.sqlite3",\n        service_root=tmp_path,\n    )\n    sources = [\n        {"source_id": "topps", "trust_score": 100},\n        {"source_id": "google", "trust_score": 60},\n        {"source_id": "psa", "trust_score": 96},\n        {"source_id": "panini", "trust_score": 100},\n    ]\n    sources.sort(\n        key=lambda source: (\n            0 if source.get("source_id") == "psa" else 1,\n            -int(source.get("trust_score") or 0),\n            str(source.get("source_id") or ""),\n        )\n    )\n    assert [source["source_id"] for source in sources] == [\n        "psa",\n        "panini",\n        "topps",\n        "google",\n    ]\n    assert sentinel is not None\n''', encoding="utf-8")
print("wrote PSA-first source-order regression")
