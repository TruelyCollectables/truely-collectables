#!/usr/bin/env python3
from pathlib import Path

storage = Path("services/instacomp-ai/app/storage.py")
source = storage.read_text(encoding="utf-8")
old = "        local_vision: dict | None,\n        checklist: dict,\n"
new = "        local_vision: dict | None = None,\n        checklist: dict,\n"
if old in source:
    source = source.replace(old, new, 1)
elif new not in source:
    raise SystemExit("MemoryStore.save_scan local_vision parameter changed unexpectedly.")
storage.write_text(source, encoding="utf-8")

local_vision = Path("services/instacomp-ai/app/local_vision.py")
source = local_vision.read_text(encoding="utf-8")
old = "    font = ImageFont.load_default(size=32)\n"
new = '''    try:\n        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 42)\n    except OSError:\n        font = ImageFont.load_default()\n'''
if old in source:
    source = source.replace(old, new, 1)
elif new not in source:
    raise SystemExit("Synthetic OCR font setup changed unexpectedly.")
local_vision.write_text(source, encoding="utf-8")

print(f"fixed {storage}")
print(f"fixed {local_vision}")
