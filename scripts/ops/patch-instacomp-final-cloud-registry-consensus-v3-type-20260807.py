from pathlib import Path

path = Path("src/lib/instacomp-consensus.ts")
text = path.read_text(encoding="utf-8")
old = "const productTokens = new Set(semanticTokens(catalogIdentity.product));"
new = "const productTokens = new Set(semanticTokens((catalogIdentity as typeof catalogIdentity & { product?: string | null }).product));"
if text.count(old) != 1:
    raise SystemExit(f"expected one Registry product type anchor, found {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("PASS fixed Registry product type contract")
