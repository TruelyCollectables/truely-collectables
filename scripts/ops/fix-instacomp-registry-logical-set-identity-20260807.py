from pathlib import Path

path = Path("src/lib/instacomp-learning-server.ts")
text = path.read_text(encoding="utf-8")
old = '''    product: match.product,
    player: match.player,
    year: match.year,
    setName: match.product || match.setName,
    registrySetName: match.setName,
'''
new = '''    product: match.product,
    player: match.player,
    year: match.year,
    // Identity consensus is against the logical checklist set (Base, Groovy,
    // inserts/subsets), not the release/product display title. Keep product
    // separately for search/display while the Registry referee votes the set.
    setName: match.setName,
    registrySetName: match.setName,
'''
if old not in text:
    raise SystemExit("Expected Registry catalog identity mapping was not found")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("PASS Registry catalog identity now uses logical checklist set")
