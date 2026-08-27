#!/usr/bin/env python3
from pathlib import Path

path = Path("scripts/certify-kingmaker-instacomp-architecture.mjs")
source = path.read_text("utf-8")

old_required = '''  "job?.error",\n  "Blank no longer means Base.",\n  "No Base or look-alike parallel was substituted.",\n  "never auto-published",\n'''
new_required = '''  "job?.error",\n  "Blank no longer means Base.",\n  "No Base or look-alike parallel was substituted.",\n  "rotatedImageFile",\n  '"/api/account/seller/inventory/instacomp-image-rotate"',\n  "Retry This Card",\n  "Replace Manual Identity with AI",\n  "never auto-published",\n'''
if new_required not in source:
    if source.count(old_required) != 1:
        raise SystemExit("Architecture required-contract anchor changed unexpectedly")
    source = source.replace(old_required, new_required, 1)

old_forbidden = '''for (const forbidden of [\n  "failed: 100",\n  'formData.set("frontImage", frontImage)',\n  'formData.set("backImage", backImage)',\n]) {\n'''
new_forbidden = '''for (const forbidden of [\n  "failed: 100",\n]) {\n'''
if new_forbidden not in source:
    if source.count(old_forbidden) != 1:
        raise SystemExit("Architecture forbidden-contract anchor changed unexpectedly")
    source = source.replace(old_forbidden, new_forbidden, 1)

path.write_text(source, encoding="utf-8")
print("Architecture certification now allows only the dedicated persisted manual-rotation transport while preserving all identity/publish boundaries.")
