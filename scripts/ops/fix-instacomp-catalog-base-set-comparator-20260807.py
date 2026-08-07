from pathlib import Path

path = Path("src/lib/instacomp-consensus.ts")
text = path.read_text(encoding="utf-8")
old = '''  if (field === "setName") {
    const readerTokens = semanticTokens(readerValue);
    const catalogTokens = new Set(
      semanticTokens(
        [catalogValue, catalogRegistrySetName(catalogIdentity)]
          .filter(Boolean)
          .join(" "),
      ),
    );
    const logicalSetTokens = logicalRegistrySetTokens(catalogIdentity);
    return (
        readerTokens.length > 0 &&
        readerTokens.every((token) => catalogTokens.has(token))
      );
  }
'''
new = '''  if (field === "setName") {
    const registrySetName = catalogRegistrySetName(catalogIdentity);
    const catalogSetValues = [catalogValue, registrySetName].filter(Boolean);
    // semanticTokens intentionally strips generic words such as "base". Handle
    // the logical Base set explicitly so Base vs Base cannot become an empty-token
    // false conflict while still refusing Base vs a named insert/subset.
    if (isGenericBase(readerValue)) {
      return catalogSetValues.some((value) => isGenericBase(value));
    }
    if (catalogSetValues.some((value) => isGenericBase(value))) {
      return false;
    }
    const readerTokens = semanticTokens(readerValue);
    const catalogTokens = new Set(semanticTokens(catalogSetValues.join(" ")));
    return (
      readerTokens.length > 0 &&
      readerTokens.every((token) => catalogTokens.has(token))
    );
  }
'''
if old not in text:
    raise SystemExit("Expected catalog set comparator block was not found")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("PASS Base checklist set comparator preserves Base identity")
