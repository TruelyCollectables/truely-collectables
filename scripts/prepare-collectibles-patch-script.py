from pathlib import Path
import re

patch = Path("scripts/apply-collectibles-catalog-expansion.py")
text = patch.read_text()
pattern = r'''replace_once\(\n\s+"src/app/shop/page\.tsx",\n.*?\n\s+"shop collectible intro",\n\)\n'''
replacement = 'print("Shop collectible intro prepared by whitespace-tolerant preflight")\n'
updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
if count != 1 and "Shop collectible intro prepared by whitespace-tolerant preflight" not in text:
    raise SystemExit(f"Expected one redundant shop intro patch block; found {count}")
patch.write_text(updated if count == 1 else text)
print("Prepared collectibles patch script")
