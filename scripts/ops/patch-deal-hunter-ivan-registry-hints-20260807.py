# retrigger certified main-push repair
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "src/app/api/instacomp/scan/route.ts"


def replace_once(text: str, old: str, new: str) -> str:
    if old not in text:
        raise SystemExit(f"missing exact patch anchor: {old[:120]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"non-unique patch anchor: {old[:120]!r}")
    return text.replace(old, new, 1)


s = TARGET.read_text(encoding="utf-8")
if "listingIdentityHint.brand" in s and "listingIdentityHint.setName" in s:
    print("Ivan Registry lookup hints already present")
    raise SystemExit(0)

old = '''function extractUntrustedListingIdentityHint(value: unknown) {
  const title = String(value || "").trim().slice(0, 1000);
  if (!title) return { title: null, year: null, cardNumber: null };
  const year = title.match(/\\b((?:19|20)\\d{2})(?:[-/]\\d{2,4})?\\b/)?.[1] || null;
  const cardNumber =
    title.match(/(?:\\bcard\\s*)?#\\s*([A-Za-z0-9][A-Za-z0-9.-]{0,24})\\b/i)?.[1] || null;
  return { title, year, cardNumber };
}
'''
new = '''function extractUntrustedListingIdentityHint(value: unknown) {
  const title = String(value || "").trim().slice(0, 1000);
  if (!title) return { title: null, year: null, cardNumber: null, brand: null, setName: null };
  const season =
    title.match(/\\b((?:19|20)\\d{2}[-/](?:\\d{2}|(?:19|20)\\d{2}))\\b/)?.[1] ||
    title.match(/\\b((?:19|20)\\d{2})\\b/)?.[1] || null;
  const cardNumber =
    title.match(/(?:\\bcard\\s*)?#\\s*([A-Za-z0-9][A-Za-z0-9.-]{0,24})\\b/i)?.[1] || null;
  const productRules: Array<{ pattern: RegExp; brand: string; setName: string }> = [
    { pattern: /\\bO-?Pee-?Chee\\s+Platinum\\b/i, brand: "O-Pee-Chee", setName: "O-Pee-Chee Platinum" },
    { pattern: /\\bNational\\s+Hockey\\s+Card\\s+Day\\b/i, brand: "Upper Deck", setName: "National Hockey Card Day" },
    { pattern: /\\bParkhurst\\b/i, brand: "Upper Deck", setName: "Parkhurst" },
    { pattern: /\\bSPx\\b/i, brand: "Upper Deck", setName: "SPx" },
    { pattern: /\\bFlair\\b/i, brand: "Upper Deck", setName: "Flair" },
    { pattern: /\\bTopps\\s+Now\\b/i, brand: "Topps", setName: "Topps Now" },
    { pattern: /\\bPrizm\\b/i, brand: "Panini", setName: "Prizm" },
    { pattern: /\\bBowman\\s+Draft\\b/i, brand: "Topps", setName: "Bowman Draft" },
    { pattern: /\\bBowman\\b/i, brand: "Topps", setName: "Bowman" },
  ];
  const product = productRules.find((rule) => rule.pattern.test(title)) || null;
  const brand = product?.brand || (/\\bUpper\\s+Deck\\b/i.test(title) ? "Upper Deck" : null);
  return { title, year: season, cardNumber, brand, setName: product?.setName || null };
}
'''
s = replace_once(s, old, new)

old = '''    const registryProbeAi = {
      ...evidenceAi,
      ...(listingIdentityHint.year ? { year: listingIdentityHint.year } : {}),
      ...(listingIdentityHint.cardNumber ? { cardNumber: listingIdentityHint.cardNumber } : {}),
    };'''
new = '''    const registryProbeAi = {
      ...evidenceAi,
      ...(listingIdentityHint.year ? { year: listingIdentityHint.year } : {}),
      ...(listingIdentityHint.brand ? { brand: listingIdentityHint.brand } : {}),
      ...(listingIdentityHint.setName ? { setName: listingIdentityHint.setName } : {}),
      ...(listingIdentityHint.cardNumber ? { cardNumber: listingIdentityHint.cardNumber } : {}),
    };'''
s = replace_once(s, old, new)

old = '''        untrustedListingIdentityHint: {
          supplied: Boolean(listingIdentityHint.title),
          year: listingIdentityHint.year,
          cardNumber: listingIdentityHint.cardNumber,
          trustedForIdentity: false,
        },'''
new = '''        untrustedListingIdentityHint: {
          supplied: Boolean(listingIdentityHint.title),
          year: listingIdentityHint.year,
          brand: listingIdentityHint.brand,
          setName: listingIdentityHint.setName,
          cardNumber: listingIdentityHint.cardNumber,
          trustedForIdentity: false,
        },'''
s = replace_once(s, old, new)

TARGET.write_text(s, encoding="utf-8")
print("PASS applied controlled Deal Hunter Registry lookup hints")
