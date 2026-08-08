from pathlib import Path

path = Path('src/app/api/instacomp/deal-hunter/evaluate/core.ts')
text = path.read_text(encoding='utf-8')

anchor = 'import { getInstaCompServiceToken } from "../../../../../lib/tcos-profit-hunter-secrets";\n'
imports = anchor + 'import { loadExactCardMarketHistory } from "../../../../../lib/instacomp-market-history";\nimport { trustedHistoricalSoldPricing } from "../../../../../lib/deal-hunter-trusted-sold-history";\n'
if text.count(anchor) != 1:
    raise SystemExit('Core import anchor missing; refusing fuzzy patch.')
text = text.replace(anchor, imports, 1)

function_anchor = '\nasync function persistRunSummary(body: Record<string, any>) {'
helper = r'''

async function applyTrustedHistoricalSoldFallback(scan: Record<string, any>) {
  const exactMarket = (scan.exactMarket || {}) as Record<string, any>;
  const liveSoldCount = Number(exactMarket.pricingEligibleSoldCount || 0);
  const livePrice = numberValue(exactMarket.trustedSuggestedPrice);
  if (liveSoldCount > 0 && livePrice !== null) return scan;

  const registry = (scan.checklistRegistry || {}) as Record<string, any>;
  const identityId = text(registry.identityId, 100);
  const fingerprint = text(registry.fingerprintSha256, 128);
  if (registry.matched !== true || !identityId || !fingerprint) return scan;

  try {
    const history = await loadExactCardMarketHistory(identityId);
    const historical = trustedHistoricalSoldPricing({
      history,
      registryIdentityId: identityId,
      registryFingerprintSha256: fingerprint,
      maxAgeDays: 90,
    });
    if (!historical) return scan;

    return {
      ...scan,
      exactMarket: {
        ...exactMarket,
        status: "ready",
        pricingEligibleSoldCount: historical.soldCount,
        trustedSuggestedPrice: historical.medianDeliveredPrice,
        historicalSoldFallback: {
          used: true,
          source: "trusted_exact_card_market_history",
          soldCount: historical.soldCount,
          medianDeliveredPrice: historical.medianDeliveredPrice,
          oldestSoldAt: historical.oldestSoldAt,
          newestSoldAt: historical.newestSoldAt,
          maxAgeDays: historical.maxAgeDays,
          registryIdentityId: identityId,
          registryFingerprintSha256: fingerprint,
        },
      },
    };
  } catch (error) {
    return {
      ...scan,
      exactMarket: {
        ...exactMarket,
        historicalSoldFallback: {
          used: false,
          error: text(error instanceof Error ? error.message : String(error), 500),
        },
      },
    };
  }
}
'''
if text.count(function_anchor) != 1:
    raise SystemExit('persistRunSummary anchor missing; refusing fuzzy patch.')
text = text.replace(function_anchor, helper + function_anchor, 1)

old = '''    const evaluation = economics(listing, scan);\n    const persistence = await persistEvaluation({ listing, scan, evaluation });\n    return json({\n'''
new = '''    const pricedScan = await applyTrustedHistoricalSoldFallback(scan);\n    const evaluation = economics(listing, pricedScan);\n    const persistence = await persistEvaluation({ listing, scan: pricedScan, evaluation });\n    return json({\n'''
if text.count(old) != 1:
    raise SystemExit('Core evaluation anchor missing; refusing fuzzy patch.')
text = text.replace(old, new, 1)

old_return = '''      scan,\n      boundaries: {\n'''
new_return = '''      scan: pricedScan,\n      boundaries: {\n'''
if text.count(old_return) != 1:
    raise SystemExit('Core return scan anchor missing; refusing fuzzy patch.')
text = text.replace(old_return, new_return, 1)

path.write_text(text, encoding='utf-8')
print('Trusted exact-card SOLD history fallback wired into Deal Hunter economics.')
