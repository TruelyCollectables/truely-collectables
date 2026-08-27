#!/usr/bin/env python3
from pathlib import Path

path = Path("services/instacomp-ai/scripts/run-supervised-203-permanent-uuid.sh")
source = path.read_text(encoding="utf-8")
old = '''for root in (home / "Downloads", home / "Desktop", home / "Documents"):
    if not root.is_dir():
        continue
    for path in root.rglob("*.zip"):
        try:
            relative = path.relative_to(root)
        except ValueError:
            continue
        if len(relative.parts) > 3:
            continue
        name = path.name.lower()
        if name == "all scans.zip" or "scans" in name:
            candidates.append(path)
'''
new = '''print("Searching bounded locations for the reviewed All scans.zip...", file=sys.stderr)
for root in (home / "Downloads", home / "Desktop", home / "Documents"):
    if not root.is_dir():
        continue
    # Direct children only.
    try:
        direct_entries = list(root.iterdir())
    except OSError:
        continue
    for path in direct_entries:
        if path.is_file() and path.suffix.lower() == ".zip":
            name = path.name.lower()
            if name == "all scans.zip" or "scans" in name:
                candidates.append(path)
        elif path.is_dir():
            # Exactly one folder below the root; never recurse further.
            try:
                child_entries = list(path.iterdir())
            except OSError:
                continue
            for child in child_entries:
                if child.is_file() and child.suffix.lower() == ".zip":
                    name = child.name.lower()
                    if name == "all scans.zip" or "scans" in name:
                        candidates.append(child)
'''
if new in source:
    print("bounded archive discovery already patched")
elif source.count(old) == 1:
    path.write_text(source.replace(old, new, 1), encoding="utf-8")
    print("patched archive discovery to direct + one-level-only search")
else:
    raise SystemExit(f"expected one recursive archive-discovery block, found {source.count(old)}")
