from __future__ import annotations

import re
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"Could not locate {label} block")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str, flags: int = 0) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count == 0:
        if replacement in text:
            return text
        raise SystemExit(f"Could not locate {label} pattern")
    return updated


def patch_instacomp_matcher() -> None:
    path = Path("src/lib/instacomp.ts")
    text = path.read_text()

    text = replace_once(
        text,
        '''function normalizeCardNumber(value: string | null | undefined) {
  if (!value) return "";
  return String(value).toLowerCase().replace("#", "").trim();
}
''',
        '''function normalizeCardNumber(value: string | null | undefined) {
  if (!value) return "";
  return String(value).toLowerCase().replace("#", "").trim();
}

function stripSeasonRanges(value: string) {
  return String(value || "").replace(
    /\\b(?:19|20)\\d{2}\\s*[-/]\\s*\\d{2,4}\\b/g,
    " ",
  );
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
}

function titleHasExactCardNumber(
  title: string,
  value: string | null | undefined,
) {
  const cardNumber = normalizeCardNumber(value);
  if (!cardNumber) return false;

  const flexible = escapeRegex(cardNumber).replace(/\\\\-/g, "[-\\\\s]?");
  const explicit = new RegExp(
    `(?:#|card\\\\s*(?:no\\\\.?|number)?|no\\\\.?)\\\\s*${flexible}(?![a-z0-9])`,
    "i",
  );
  if (explicit.test(title)) return true;

  const stripped = stripSeasonRanges(normalizeText(title));
  if (/[a-z]/i.test(cardNumber)) {
    return new RegExp(`(?:^|[^a-z0-9])${flexible}(?:$|[^a-z0-9])`, "i").test(
      stripped,
    );
  }

  const number = Number(cardNumber);
  if (!Number.isFinite(number) || number <= 10) return false;
  return new RegExp(`(?:^|[^0-9])${escapeRegex(cardNumber)}(?:$|[^0-9])`).test(
    stripped,
  );
}

function numericGrade(value: string | null | undefined) {
  const match = String(value || "").match(/\\b(10|[0-9](?:\\.[0-9])?)\\b/);
  return match ? Number(match[1]) : null;
}

function graderGradesFromTitle(title: string, grader: string) {
  if (!grader) return [] as number[];
  const normalizedTitle = normalizeText(title);
  const graderPattern = escapeRegex(grader).replace(/\\\\s+/g, "\\\\s*");
  const pattern = new RegExp(
    `(?:^|\\\\s)${graderPattern}\\\\s*(?:(?:gem|near|nm|mint|pristine)\\\\s*)*(10|[0-9](?:\\\\.[0-9])?)\\\\b`,
    "gi",
  );
  return Array.from(normalizedTitle.matchAll(pattern))
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
}
''',
        "matcher helpers",
    )

    text = regex_once(
        text,
        r'''function serialRunDenominatorFromTitle\(title: string\) \{.*?\n\}''',
        '''function serialRunDenominatorFromTitle(title: string) {
  const normalized = stripSeasonRanges(
    normalizeText(title)
      .replace(/\\bone\\s+of\\s+one\\b/g, "1/1")
      .replace(/\\b1\\s+of\\s+1\\b/g, "1/1"),
  );
  const parsed = extractInstaCompSerialNumber(normalized);
  const denominator = Number(parsed?.denominator);

  return Number.isFinite(denominator) && denominator > 0 ? denominator : null;
}''',
        "serial denominator parser",
        re.S,
    )

    text = replace_once(
        text,
        '''  if (cardNumber) {
    const padded = ` ${t} `;

    const patterns = [
      `#${cardNumber}`,
      ` ${cardNumber} `,
      `-${cardNumber} `,
      `/${cardNumber} `,
      ` no ${cardNumber} `,
      ` number ${cardNumber} `,
      ` card ${cardNumber} `,
    ];

    if (patterns.some((pattern) => padded.includes(pattern))) {
      score += 25;
      flags.push("card #");
    }
  }
''',
        '''  if (cardNumber && titleHasExactCardNumber(title, ai.cardNumber)) {
    score += 25;
    flags.push("card #");
  }
''',
        "card-number scoring",
    )

    text = replace_once(
        text,
        '''  if (serial.normalized) {
    const compactTitle = t.replace(/\\s+/g, "");
''',
        '''  if (serial.normalized) {
    const compactTitle = stripSeasonRanges(t).replace(/\\s+/g, "");
''',
        "serial scoring season guard",
    )

    text = regex_once(
        text,
        r'''  if \(grade\) \{\n    const gradePatterns = \[.*?\n  \}\n''',
        '''  if (grade) {
    const targetGrade = numericGrade(ai.gradeValue);
    const visibleGrades = graderGradesFromTitle(title, grader);
    if (
      targetGrade !== null &&
      visibleGrades.some((visibleGrade) => visibleGrade === targetGrade)
    ) {
      score += 20;
      flags.push("grade");
    } else if (targetGrade !== null && visibleGrades.length) {
      score -= 150;
      flags.push(
        `grade mismatch: expected ${cleanPart(ai.gradingCompany)} ${cleanPart(
          ai.gradeValue,
        )}; listing says ${cleanPart(ai.gradingCompany)} ${visibleGrades.join("/")}`,
      );
    }
  }
''',
        "grade scoring",
        re.S,
    )

    text = replace_once(
        text,
        '''    .filter(
      (comp) =>
        !comp.flags.some((flag) => flag.startsWith("parallel mismatch:")),
    )
''',
        '''    .filter(
      (comp) =>
        !comp.flags.some(
          (flag) =>
            flag.startsWith("parallel mismatch:") ||
            flag.startsWith("grade mismatch:"),
        ),
    )
''',
        "mismatch filtering",
    )

    path.write_text(text)


def patch_exact_provider() -> None:
    path = Path("src/lib/instacomp-exact-market-provider.ts")
    text = path.read_text()

    text = replace_once(
        text,
        '''function titleDenominators(value: string | null | undefined) {
  return Array.from(String(value || "").matchAll(/(?:\\b\\d{1,6}\\s*)?\\/\\s*(\\d{1,6})\\b/g))
    .map((match) => Number(match[1]))
    .filter((number) => Number.isFinite(number) && number > 0);
}
''',
        '''function titleDenominators(value: string | null | undefined) {
  const withoutSeasons = String(value || "").replace(
    /\\b(?:19|20)\\d{2}\\s*[-/]\\s*\\d{2,4}\\b/g,
    " ",
  );
  return Array.from(
    withoutSeasons.matchAll(/(?:\\b\\d{1,6}\\s*)?\\/\\s*(\\d{1,6})\\b/g),
  )
    .map((match) => Number(match[1]))
    .filter((number) => Number.isFinite(number) && number > 0);
}
''',
        "exact-provider season guard",
    )

    text = replace_once(
        text,
        '''    title: item.title,
    price: item.price,
    currency: "USD",
''',
        '''    title: item.title,
    price: item.price,
    itemPrice: item.itemPrice,
    shippingPrice: item.shippingPrice,
    priceIncludesShipping: item.priceIncludesShipping,
    currency: "USD",
''',
        "delivered-price metadata",
    )

    path.write_text(text)


def patch_live_pipeline() -> None:
    path = Path("src/lib/instacomp-live-pipeline.ts")
    text = path.read_text()

    text = replace_once(
        text,
        '''export function dedupeExactMarketComps(values: InstaCompComp[], limit = 50) {
  const seen = new Set<string>();
  return values
    .filter((comp) => {
      if (!hasTrustedDeliveredPrice(comp)) return false;
      const key = compKey(comp);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
''',
        '''export function dedupeExactMarketEvidence(values: InstaCompComp[], limit = 50) {
  const seen = new Set<string>();
  return values
    .filter((comp) => {
      if (!Number.isFinite(Number(comp.price)) || Number(comp.price) <= 0) return false;
      const key = compKey(comp);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      if (right.matchScore !== left.matchScore) {
        return right.matchScore - left.matchScore;
      }
      return left.price - right.price;
    })
    .slice(0, limit);
}

export function dedupeExactMarketComps(values: InstaCompComp[], limit = 50) {
  return dedupeExactMarketEvidence(values, limit).filter(hasTrustedDeliveredPrice);
''',
        "evidence/pricing separation",
    )

    text = replace_once(
        text,
        '''  const sold = dedupeExactMarketComps(
    sources.flatMap((source) => source?.sold?.results || []),
    50,
  );
  const active = dedupeExactMarketComps(
    sources.flatMap((source) => source?.active?.results || []),
    30,
  );
  const pricing = calculateInstaCompSweetSpot({ sold, active });
''',
        '''  const sold = dedupeExactMarketEvidence(
    sources.flatMap((source) => source?.sold?.results || []),
    50,
  );
  const active = dedupeExactMarketEvidence(
    sources.flatMap((source) => source?.active?.results || []),
    30,
  );
  const pricingSold = dedupeExactMarketComps(sold, 50);
  const pricingActive = dedupeExactMarketComps(active, 30);
  const pricing = calculateInstaCompSweetSpot({
    sold: pricingSold,
    active: pricingActive,
  });
''',
        "market evidence merge",
    )

    text = replace_once(
        text,
        '''    trustedSuggestedPrice: sold.length ? pricing.suggestedPrice : null,
    status: sold.length ? "ready" : providerError ? "provider_error" : "no_exact_sold",
''',
        '''    trustedSuggestedPrice: pricingSold.length ? pricing.suggestedPrice : null,
    status: pricingSold.length
      ? "ready"
      : providerError
        ? "provider_error"
        : "no_exact_sold",
''',
        "trusted sold gating",
    )

    path.write_text(text)


def patch_openai_market_provider() -> None:
    path = Path("src/lib/instacomp-openai-web-market-provider.ts")
    text = path.read_text()

    text = replace_once(
        text,
        '''        sourceCategory: params.lane === "sold" ? ("sold" as const) : ("marketplace" as const),
''',
        '''        sourceCategory: "reference" as const,
''',
        "OpenAI candidate category",
    )
    text = replace_once(
        text,
        '''      flags: Array.from(new Set([...row.flags, "direct cited eBay sold source", "shipping verified"])).slice(0, 20),
''',
        '''      flags: Array.from(
        new Set([
          ...row.flags,
          "direct cited eBay sold discovery candidate",
          "not independently verified for pricing",
        ]),
      ).slice(0, 20),
''',
        "OpenAI sold flags",
    )
    text = replace_once(
        text,
        '''      flags: Array.from(new Set([...row.flags, "direct cited eBay active source", "shipping verified"])).slice(0, 20),
''',
        '''      flags: Array.from(
        new Set([
          ...row.flags,
          "direct cited eBay active discovery candidate",
          "not independently verified for pricing",
        ]),
      ).slice(0, 20),
''',
        "OpenAI active flags",
    )
    text = text.replace(
        "passed identity, image, date, and delivered-price verification.",
        "passed initial identity screening but remain discovery-only until independently cross-verified.",
    )
    text = text.replace(
        "passed identity, image, and delivered-price verification.",
        "passed initial identity screening but remain discovery-only until independently cross-verified.",
    )

    path.write_text(text)


def patch_legacy_ebay_active() -> None:
    path = Path("src/app/api/instacomp/scan/route.ts")
    text = path.read_text()

    text = replace_once(
        text,
        '''        title: String(item?.title || ""),
        price: Number.isFinite(value) ? value : 0,
        currency: String(item?.price?.currency || "USD"),
''',
        '''        title: String(item?.title || ""),
        price: Number.isFinite(value) ? value : 0,
        itemPrice: Number.isFinite(value) ? value : null,
        shippingPrice: null,
        priceIncludesShipping: false,
        currency: String(item?.price?.currency || "USD"),
''',
        "official eBay active shipping metadata",
    )

    text = replace_once(
        text,
        '''  let results = filterAndRankExactMatches(rawComps, ai, 3, 55);
''',
        '''  let results = filterAndRankExactMatches(rawComps, ai, 3, 55).map((result) => ({
    ...result,
    flags: Array.from(new Set([...result.flags, "shipping unknown", "not used for pricing"])),
  }));
''',
        "official active evidence flags",
    )

    path.write_text(text)


def patch_live_scan_persistence() -> None:
    path = Path("src/app/api/instacomp/live-scan/route.ts")
    text = path.read_text()

    text = replace_once(
        text,
        '''  soldSearchUrl: string | null;
}): Promise<PersistenceResult> {
''',
        '''  soldSearchUrl: string | null;
  exactMarketEvidence?: Record<string, unknown> | null;
}): Promise<PersistenceResult> {
''',
        "exact persistence signature",
    )

    text = replace_once(
        text,
        '''  const { error } = await supabase
    .from("instacomp_scans")
    .update({
      search_query: params.query,
      suggested_price: params.suggestedPrice,
      ebay_sold_url: params.soldSearchUrl,
    })
    .eq("id", params.scanId);
''',
        '''  const { data: existing } = await supabase
    .from("instacomp_scans")
    .select("raw_comp_results")
    .eq("id", params.scanId)
    .maybeSingle();
  const previousRaw =
    existing?.raw_comp_results && typeof existing.raw_comp_results === "object"
      ? (existing.raw_comp_results as Record<string, unknown>)
      : {};
  const { error } = await supabase
    .from("instacomp_scans")
    .update({
      search_query: params.query,
      suggested_price: params.suggestedPrice,
      ebay_sold_url: params.soldSearchUrl,
      raw_comp_results: {
        ...previousRaw,
        exactMarket: params.exactMarketEvidence || null,
      },
    })
    .eq("id", params.scanId);
''',
        "exact evidence persistence",
    )

    text = replace_once(
        text,
        '''  const summary = mergeExactMarketSources([serpSource, openAiSource]);
  const exactProviders = [
    serpSource.sold,
    openAiSource.sold,
    serpSource.active,
    openAiSource.active,
  ];
''',
        '''  const officialEbayActive = (base.providers || []).find(
    (provider) => provider.source === "ebay_active",
  );
  const officialActiveSource: InstaCompExactMarketSource = {
    sold: {
      source: "ebay_official_sold_unavailable",
      label: "eBay Official Sold",
      status: "not_configured",
      message: "The official Browse API does not expose completed sales.",
      results: [],
    },
    active:
      officialEbayActive || {
        source: "ebay_active",
        label: "eBay Active",
        status: "no_matches",
        message: "The official eBay Browse search returned no exact active evidence.",
        results: [],
      },
  };
  const summary = mergeExactMarketSources([serpSource, officialActiveSource]);
  const exactProviders = [
    serpSource.sold,
    serpSource.active,
    officialActiveSource.active,
    openAiSource.sold,
    openAiSource.active,
  ];
''',
        "trusted provider merge",
    )

    text = replace_once(
        text,
        '''  const persistence = await persistExactMarketSummary({
    scanId: base.scanId ? String(base.scanId) : null,
    query: exactTitle,
    suggestedPrice: summary.trustedSuggestedPrice,
    soldSearchUrl,
  });
''',
        '''  const exactMarketEvidence = {
    status: summary.status,
    query: exactTitle,
    queries: serp?.queries || [exactTitle],
    soldEvidenceCount: summary.sold.length,
    pricingEligibleSoldCount: summary.pricing.soldCount,
    activeEvidenceCount: summary.active.length,
    pricingEligibleActiveCount: summary.pricing.activeCount,
    trustedSuggestedPrice: summary.trustedSuggestedPrice,
    pricing: summary.pricing,
    sold: summary.sold.slice(0, 25),
    active: summary.active.slice(0, 25),
    discoveryCandidates: {
      sold: openAiSource.sold.results.slice(0, 10),
      active: openAiSource.active.results.slice(0, 10),
    },
    providers: exactProviders.map((provider) => ({
      source: provider.source,
      label: provider.label,
      status: provider.status,
      message: provider.message,
      results: provider.results.slice(0, 10),
    })),
  };
  const persistence = await persistExactMarketSummary({
    scanId: base.scanId ? String(base.scanId) : null,
    query: exactTitle,
    suggestedPrice: summary.trustedSuggestedPrice,
    soldSearchUrl,
    exactMarketEvidence,
  });
''',
        "exact persistence call",
    )

    text = replace_once(
        text,
        '''  const note = summary.sold.length
    ? `${summary.sold.length} strict exact sold comp${summary.sold.length === 1 ? "" : "s"} support the InstaComp price. ${summary.active.length} exact active listing${summary.active.length === 1 ? "" : "s"} were checked as competition.`
''',
        '''  const note = summary.pricing.soldCount
    ? `${summary.pricing.soldCount} strict exact, delivered-price sold comp${summary.pricing.soldCount === 1 ? "" : "s"} support the InstaComp price. ${summary.active.length} exact active listing${summary.active.length === 1 ? "" : "s"} were retained as evidence; ${summary.pricing.activeCount} had complete delivered pricing.`
''',
        "trusted note count",
    )

    text = replace_once(
        text,
        '''      soldCount: summary.sold.length,
      activeCount: summary.active.length,
      trustedSuggestedPrice: summary.trustedSuggestedPrice,
''',
        '''      soldCount: summary.sold.length,
      pricingEligibleSoldCount: summary.pricing.soldCount,
      activeCount: summary.active.length,
      pricingEligibleActiveCount: summary.pricing.activeCount,
      trustedSuggestedPrice: summary.trustedSuggestedPrice,
''',
        "exact response counts",
    )

    text = replace_once(
        text,
        '''      providerMessages,
    },
''',
        '''      providerMessages,
      discoveryCandidates: {
        sold: openAiSource.sold.results,
        active: openAiSource.active.results,
        trustedForPricing: false,
      },
    },
''',
        "discovery candidates response",
    )

    path.write_text(text)


def patch_regressions() -> None:
    path = Path("scripts/run-instacomp-exact-market-proof-regressions.ts")
    text = path.read_text()

    text = replace_once(
        text,
        '''import { calculateInstaCompSweetSpot } from "../src/lib/instacomp-sweet-spot";
''',
        '''import { calculateInstaCompSweetSpot } from "../src/lib/instacomp-sweet-spot";
import { mergeExactMarketSources } from "../src/lib/instacomp-live-pipeline";
''',
        "regression import",
    )

    marker = '''const soldUrl = buildSerpApiEbayRequestUrl("exact card", "sold").toString();
'''
    additions = '''const seasonTarget: InstaCompAiResult = {
  player: "Season Guard",
  year: "2024-25",
  brand: "Upper Deck",
  setName: "Series 1",
  cardNumber: "25",
  parallel: "Base",
  serialNumber: null,
  team: "Test Team",
  sport: "Hockey",
  isRookie: false,
  isAuto: false,
  isRelic: false,
  conditionGuess: "Raw",
  confidence: 1,
  notes: null,
};
assert.equal(
  filterStrictExactMarketMatches(
    [candidate("2024/25 Upper Deck Series 1 Season Guard #25", 10, 5000)],
    seasonTarget,
    10,
  ).length,
  1,
  "a 2024/25 season must not be treated as a /25 print run",
);
const numberedTarget = { ...seasonTarget, serialNumber: "07/25" };
assert.equal(
  filterStrictExactMarketMatches(
    [candidate("2024/25 Upper Deck Series 1 Season Guard #25", 10, 5001)],
    numberedTarget,
    10,
  ).length,
  0,
  "a season written 2024/25 must not satisfy a true /25 serial gate",
);

const psaNine: InstaCompAiResult = {
  ...seasonTarget,
  player: "Grade Guard",
  year: "1989",
  brand: "Topps",
  setName: "Topps",
  cardNumber: "9",
  gradingCompany: "PSA",
  gradeValue: "9",
  conditionGuess: "Graded",
};
assert.equal(
  filterStrictExactMarketMatches(
    [candidate("1989 Topps Grade Guard #9 PSA 10", 10, 5002)],
    psaNine,
    10,
  ).length,
  0,
  "card #9 must never make a PSA 10 listing pass as PSA 9",
);
assert.equal(
  filterStrictExactMarketMatches(
    [candidate("1989 Topps Grade Guard #9 PSA 9", 10, 5003)],
    psaNine,
    10,
  ).length,
  1,
  "the exact PSA 9 grade must still pass",
);

const shippingUnknown = {
  ...candidate("2024-25 Upper Deck Series 1 Season Guard #25", 10, 5004),
  matchScore: 100,
  flags: ["strict exact identity", "shipping unknown"],
  itemPrice: 10,
  shippingPrice: null,
  priceIncludesShipping: false,
};
const delivered = {
  ...candidate("2024-25 Upper Deck Series 1 Season Guard #25", 12, 5005),
  matchScore: 100,
  flags: ["strict exact identity", "price includes reported shipping"],
  itemPrice: 10,
  shippingPrice: 2,
  priceIncludesShipping: true,
};
const merged = mergeExactMarketSources([
  {
    sold: {
      source: "fixture_sold",
      label: "Fixture Sold",
      status: "live",
      message: null,
      results: [delivered],
    },
    active: {
      source: "fixture_active",
      label: "Fixture Active",
      status: "live",
      message: null,
      results: [shippingUnknown],
    },
  },
]);
assert.equal(merged.active.length, 1, "shipping-unknown exact active evidence must stay visible");
assert.equal(merged.pricing.activeCount, 0, "shipping-unknown evidence must not enter pricing");
assert.equal(merged.pricing.soldCount, 1, "delivered-price sold evidence must enter pricing");
assert.ok(merged.trustedSuggestedPrice && merged.trustedSuggestedPrice > 0);

'''
    if additions not in text:
        if marker not in text:
            raise SystemExit("Could not locate regression insertion marker")
        text = text.replace(marker, additions + marker, 1)

    path.write_text(text)


def main() -> None:
    patch_instacomp_matcher()
    patch_exact_provider()
    patch_live_pipeline()
    patch_openai_market_provider()
    patch_legacy_ebay_active()
    patch_live_scan_persistence()
    patch_regressions()


if __name__ == "__main__":
    main()
