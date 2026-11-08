from pathlib import Path


def replace_once(path: str, old: str, new: str, marker: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    if marker in text:
        print(f"SerpApi schema hardening already present: {path} ({marker})")
        return
    if old not in text:
        raise SystemExit(f"Could not locate SerpApi schema block in {path}: {marker}")
    file_path.write_text(text.replace(old, new, 1))
    print(f"Applied SerpApi schema hardening: {path} ({marker})")


PROVIDER = "src/lib/instacomp-exact-market-provider.ts"
replace_once(
    PROVIDER,
    r'''function moneyFromRecord(value: unknown, allowZero = false): number | null {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const direct = Number(record.extracted);
  if (Number.isFinite(direct) && (allowZero ? direct >= 0 : direct > 0)) return direct;

  const raw = typeof record.raw === "string" ? record.raw : "";
  if (allowZero && /free/i.test(raw)) return 0;
  const rawMatch = raw.replace(/,/g, "").match(/-?\$?\s*(\d+(?:\.\d{1,2})?)/);
  const rawNumber = rawMatch ? Number(rawMatch[1]) : NaN;
  if (Number.isFinite(rawNumber) && (allowZero ? rawNumber >= 0 : rawNumber > 0)) {
    return rawNumber;
  }
''',
    r'''function moneyFromRecord(value: unknown, allowZero = false): number | null {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const direct = typeof value === "number" ? value : Number(record.extracted);
  if (Number.isFinite(direct) && (allowZero ? direct >= 0 : direct > 0)) return direct;

  const raw =
    typeof value === "string"
      ? value
      : typeof record.raw === "string"
        ? record.raw
        : "";
  if (allowZero && /\bfree(?:\s+(?:shipping|delivery))?\b/i.test(raw)) return 0;
  const currencyMatch = raw
    .replace(/,/g, "")
    .match(/(?:US\s*)?\$\s*(\d+(?:\.\d{1,2})?)/i);
  const plainNumberMatch = raw.trim().match(/^\+?\s*(\d+(?:\.\d{1,2})?)$/);
  const rawNumber = Number(currencyMatch?.[1] || plainNumberMatch?.[1]);
  if (Number.isFinite(rawNumber) && (allowZero ? rawNumber >= 0 : rawNumber > 0)) {
    return rawNumber;
  }
''',
    "const currencyMatch = raw",
)
replace_once(
    PROVIDER,
    "serpapi_ebay_v6_",
    "serpapi_ebay_v7_",
    "serpapi_ebay_v7_",
)

REGRESSIONS = "scripts/run-instacomp-exact-market-proof-regressions.ts"
replace_once(
    REGRESSIONS,
    r'''assert.equal(normalized[0].soldDate, "Jul 20, 2026");

const seasonTarget: InstaCompAiResult = {
''',
    r'''assert.equal(normalized[0].soldDate, "Jul 20, 2026");

const normalizedDocumentedShippingStrings = normalizeEbaySerpItems({
  organic_results: [
    {
      title: fixture.cards[1].exactTitles[0],
      link: "https://www.ebay.com/itm/free-shipping",
      price: { raw: "$6.00", extracted: 6 },
      shipping: "Free shipping",
      sold_date: "Jul 20, 2026",
    },
    {
      title: fixture.cards[1].exactTitles[0],
      link: "https://www.ebay.com/itm/paid-shipping",
      price: { raw: "$6.00", extracted: 6 },
      shipping: "+$1.25 delivery",
      sold_date: "Jul 20, 2026",
    },
    {
      title: fixture.cards[1].exactTitles[0],
      link: "https://www.ebay.com/itm/calculated-shipping",
      price: { raw: "$6.00", extracted: 6 },
      shipping: "Calculated at checkout",
      sold_date: "Jul 20, 2026",
    },
  ],
});
assert.equal(normalizedDocumentedShippingStrings[0].shippingPrice, 0);
assert.equal(normalizedDocumentedShippingStrings[0].price, 6);
assert.equal(normalizedDocumentedShippingStrings[0].priceIncludesShipping, true);
assert.equal(normalizedDocumentedShippingStrings[1].shippingPrice, 1.25);
assert.equal(normalizedDocumentedShippingStrings[1].price, 7.25);
assert.equal(normalizedDocumentedShippingStrings[1].priceIncludesShipping, true);
assert.equal(normalizedDocumentedShippingStrings[2].shippingPrice, null);
assert.equal(normalizedDocumentedShippingStrings[2].priceIncludesShipping, false);

const seasonTarget: InstaCompAiResult = {
''',
    "normalizedDocumentedShippingStrings",
)
replace_once(
    REGRESSIONS,
    'assert.ok(proofSource.includes("serpapi_ebay_v6_"));',
    'assert.ok(proofSource.includes("serpapi_ebay_v7_"));',
    'proofSource.includes("serpapi_ebay_v7_")',
)

MATERIALIZATION = "scripts/run-instacomp-final-materialization.py"
replace_once(
    MATERIALIZATION,
    '''    "scripts/apply-instacomp-deep-audit-fixes.py",
    "scripts/assert-instacomp-final-source.py",
''',
    '''    "scripts/apply-instacomp-deep-audit-fixes.py",
    "scripts/apply-instacomp-serpapi-schema-fix.py",
    "scripts/assert-instacomp-final-source.py",
''',
    '"scripts/apply-instacomp-serpapi-schema-fix.py",',
)

print("InstaComp SerpApi schema hardening completed.")
