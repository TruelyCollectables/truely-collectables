#!/usr/bin/env python3
from pathlib import Path

path = Path("src/lib/instacomp-ai-local.ts")
source = path.read_text(encoding="utf-8")
old = '''  scan_id: string;\n  card_uuid: string;\n  created_at?: string;\n'''
new = '''  scan_id: string;\n  // Older test/archive payloads may predate card_uuid. Real scanner intake\n  // still fails closed if the Mac does not return a valid permanent UUID.\n  card_uuid?: string | null;\n  created_at?: string;\n'''
if new not in source:
    if source.count(old) != 1:
        raise SystemExit("InstaCompAiLocalScan card_uuid field changed unexpectedly")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")
print("card UUID local scan type compatibility applied")
