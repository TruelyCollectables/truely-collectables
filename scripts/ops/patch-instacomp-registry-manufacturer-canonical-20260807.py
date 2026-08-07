from pathlib import Path

path = Path("src/app/api/instacomp/scan/route.ts")
text = path.read_text(encoding="utf-8")
old = '''          brand:\n            registryMatch.brand ||\n            registryMatch.manufacturer ||\n            consensusAi.brand,\n'''
new = '''          brand:\n            registryMatch.manufacturer ||\n            registryMatch.brand ||\n            consensusAi.brand,\n'''
if text.count(old) != 1:
    raise SystemExit(f"expected exactly one Registry brand precedence block, found {text.count(old)}")
text = text.replace(old, new, 1)
path.write_text(text, encoding="utf-8")

patched = path.read_text(encoding="utf-8")
if new not in patched:
    raise SystemExit("manufacturer-first Registry canonicalization was not written")
if old in patched:
    raise SystemExit("brand-first Registry canonicalization survived patch")
print("Registry manufacturer canonicalization patch: PASS")
