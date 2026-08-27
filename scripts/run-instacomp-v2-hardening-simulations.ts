import {
  hardenInstaCompMarketPayload,
  independentVerifiedInstaCompSaleCount,
  isVerifiedInstaCompCompletedSale,
  robustInstaCompPrices,
  type InstaCompMarketComp,
} from "../src/lib/instacomp-market-evidence";
import { buildInstaCompV2Decision } from "../src/lib/instacomp-v2";
import { buildInstaCompScanReview } from "../src/lib/instacomp-scan-review";
import { evaluateInstaCompListingGate } from "../src/lib/instacomp-listing-gate";
import {
  buildImageFingerprint,
  chooseRegistryMatch,
  sanitizeInstaCompCachePayload,
  type ScanActor,
} from "../src/lib/instacomp-learning-server";
import type { InstaCompAiResult } from "../src/lib/instacomp";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`);
}

const now = new Date("2026-08-01T18:00:00Z");
const ai = {
  player: "Kiki Iriafen",
  year: "2025",
  brand: "Panini",
  setName: "Prizm WNBA",
  cardNumber: "149",
  parallel: "Silver Prizm",
  serialNumber: null,
  team: "Washington Mystics",
  sport: "Basketball",
  isRookie: true,
  isAuto: false,
  isRelic: false,
  conditionGuess: "Near Mint",
  confidence: 0.98,
  notes: "Printed identity confirmed.",
} satisfies InstaCompAiResult;
const review = {
  trustedForPricing: true,
  reviewReasons: [],
  identityReviewReasons: [],
  pricingReviewReasons: [],
};

function sale(id: string, price: number, extra: Partial<InstaCompMarketComp> = {}): InstaCompMarketComp {
  return {
    title: "2025 Panini Prizm WNBA Kiki Iriafen Silver Prizm #149 raw",
    price,
    itemPrice: price,
    shippingPrice: 0,
    priceIncludesShipping: true,
    currency: "USD",
    url: `https://example.test/sale/${id}`,
    source: "fixture",
    sourceLabel: "Fixture",
    sourceCategory: "sold",
    matchScore: 100,
    flags: [],
    saleId: id,
    saleVerified: true,
    finalPriceVerified: true,
    shippingVerified: true,
    soldAt: "2026-07-20T00:00:00Z",
    ...extra,
  };
}
function ask(price: number): InstaCompMarketComp {
  return {
    title: "2025 Panini Prizm WNBA Kiki Iriafen Silver Prizm #149 raw",
    price,
    currency: "USD",
    url: `https://example.test/ask/${price}`,
    source: "fixture_ask",
    sourceLabel: "Fixture Ask",
    sourceCategory: "marketplace",
    matchScore: 100,
    flags: [],
  };
}

const tests: Array<[string, () => void]> = [];
const test = (name: string, run: () => void) => tests.push([name, run]);

test("active asks cannot create a money call", () => {
  const decision = buildInstaCompV2Decision(
    { ai, review, marketValueComps: [ask(500), ask(600)] },
    { purchasePrice: 10 },
    now,
  );
  equal(decision.recommendation.action, "NO_MARKET_DATA", "ask-only action");
  equal(decision.targets.instantBuy, null, "ask-only buy target");
});

test("two independent verified sales unlock decision math", () => {
  const decision = buildInstaCompV2Decision(
    { ai, review, soldComps: [sale("one", 50), sale("two", 54, { source: "fixture_two" })] },
    { purchasePrice: 10 },
    now,
  );
  equal(decision.targets.expectedSalePrice, 52, "verified median");
  equal(decision.recommendation.action, "BUY_NOW", "verified action");
});

test("review blocks buy offer pass and ROI", () => {
  const decision = buildInstaCompV2Decision(
    {
      ai,
      review: { trustedForPricing: false, reviewReasons: ["manual_review"] },
      soldComps: [sale("one", 50), sale("two", 54)],
    },
    { purchasePrice: 45 },
    now,
  );
  equal(decision.recommendation.action, "REVIEW", "review action");
  equal(decision.targets.fairBuy, null, "review target");
  equal(decision.economics.projectedProfit, null, "review profit");
});

test("future and excluded sales are rejected", () => {
  assert(!isVerifiedInstaCompCompletedSale(sale("future", 50, { soldAt: "2027-01-01T00:00:00Z" }), now), "future sale");
  assert(!isVerifiedInstaCompCompletedSale(sale("excluded", 50, { flags: ["excluded"] }), now), "excluded sale");
});

test("outlier filter rejects a wild price", () => {
  assert(!robustInstaCompPrices([49, 50, 52, 53, 1000]).includes(1000), "outlier remains");
});

test("market payload separates asks from transaction value", () => {
  const hardened = hardenInstaCompMarketPayload(
    { ai, review, marketValueComps: [ask(500)], soldComps: [sale("one", 50)] },
    now,
  );
  equal(hardened.marketValueComps.length, 1, "verified market rows");
  equal(hardened.marketEvidence.activeAskCount, 1, "active ask count");
  assert(!hardened.review.trustedForPricing, "single sale should remain blocked");
});

test("scan review rejects marketplace asks", () => {
  const result = buildInstaCompScanReview({
    ai,
    stats: { low: 500, median: 550, average: 550, high: 600, suggestedPrice: 550 },
    marketValueComps: [ask(500), ask(600)] as any,
    hasBackImage: true,
    pairingConfidence: 0.99,
  });
  assert(!result.trustedForPricing, "asks trusted by scan review");
});

test("listing gate needs catalog identity and two verified sales", () => {
  const gate = evaluateInstaCompListingGate({
    payload: {
      ai,
      review,
      soldComps: [sale("one", 50), sale("two", 54)],
      catalogEvidence: {
        status: "catalog_confirmed",
        catalogConfirmed: true,
        actionPermissions: { publicListingClaimAllowed: true, autoPriceAllowed: true },
        compIdentity: ai,
      },
    },
  });
  assert(gate.identityApproved, gate.reviewReasons.join(","));
  assert(gate.priceApproved, gate.reviewReasons.join(","));
  equal(gate.verifiedSaleCount, 2, "gate sale count");
});

test("cache key is scoped by store and actor", () => {
  const adminA: ScanActor = { type: "admin", storeId: "store-a" };
  const adminB: ScanActor = { type: "admin", storeId: "store-b" };
  const sellerA: ScanActor = { type: "seller", storeId: "store-a", sellerAccountId: "seller-a" };
  const a = buildImageFingerprint("a".repeat(64), null, adminA);
  assert(a !== buildImageFingerprint("a".repeat(64), null, adminB), "store scope missing");
  assert(a !== buildImageFingerprint("a".repeat(64), null, sellerA), "actor scope missing");
});

test("cached payload removes prior request identifiers", () => {
  const payload = sanitizeInstaCompCachePayload({
    ok: true,
    scanId: "old",
    queue: { jobId: "job" },
    knowledge: { cacheId: "cache" },
    ai,
  });
  assert(!("scanId" in payload), "scan id leaked");
  assert(!("queue" in payload), "queue leaked");
  assert(!("knowledge" in payload), "knowledge leaked");
});

test("Registry match fails closed on auto mismatch and ambiguity", () => {
  const row = {
    card_number: "149",
    variation: null,
    autograph_status: "non-auto",
    memorabilia_status: "non-memorabilia",
    set: { name: "Base Set" },
    release: {
      product_name: "Prizm WNBA",
      release_year: "2025",
      manufacturer: { name: "Panini" },
      brand: { name: "Panini" },
      sport: { name: "Basketball" },
      league: { name: "WNBA" },
    },
    players: [{ player: { canonical_name: "Kiki Iriafen" } }],
    teams: [{ team: { canonical_name: "Washington Mystics" } }],
    identities: [{
      id: "identity-one",
      fingerprint_sha256: "c".repeat(64),
      canonical_key: "configuration=∅|language_code=∅",
      variation: null,
      autograph_status: "non-auto",
      memorabilia_status: "non-memorabilia",
      configuration_exclusivity: null,
      metadata: {},
      parallel: { name: "Silver Prizm", serial_run: null },
    }],
  };
  assert(chooseRegistryMatch({ ...ai, league: "WNBA" }, [row]), "exact Registry match failed");
  equal(chooseRegistryMatch({ ...ai, league: "WNBA", isAuto: true }, [row]), null, "auto mismatch");
  const ambiguous = JSON.parse(JSON.stringify(row));
  ambiguous.identities.push({ ...ambiguous.identities[0], id: "identity-two", fingerprint_sha256: "d".repeat(64) });
  equal(chooseRegistryMatch({ ...ai, league: "WNBA" }, [ambiguous]), null, "ambiguous match");
});

test("Registry serial run and visible parallel must agree", () => {
  const row = {
    card_number: "149",
    variation: null,
    autograph_status: "non-auto",
    memorabilia_status: "non-memorabilia",
    set: { name: "Base Set" },
    release: {
      product_name: "Prizm WNBA",
      release_year: "2025",
      manufacturer: { name: "Panini" },
      brand: { name: "Panini" },
      sport: { name: "Basketball" },
      league: { name: "WNBA" },
    },
    players: [{ player: { canonical_name: "Kiki Iriafen" } }],
    teams: [{ team: { canonical_name: "Washington Mystics" } }],
    identities: [{
      id: "serial-identity-one",
      fingerprint_sha256: "e".repeat(64),
      canonical_key: "configuration=∅|language_code=∅",
      variation: null,
      autograph_status: "non-auto",
      memorabilia_status: "non-memorabilia",
      configuration_exclusivity: null,
      metadata: {},
      parallel: { name: "Blue Prizm", serial_run: 199 },
    }],
  };
  const blueSerialAi = {
    ...ai,
    parallel: "Blue Prizm",
    serialNumber: "12/199",
    league: "WNBA",
  };
  assert(
    chooseRegistryMatch(blueSerialAi, [row]),
    "matching Blue and /199 evidence should identify the Blue /199 identity",
  );

  equal(
    chooseRegistryMatch(
      { ...blueSerialAi, parallel: "Green Prizm" },
      [row],
    ),
    null,
    "Green visual evidence must not resolve to a Blue /199 identity",
  );

  const ambiguous = JSON.parse(JSON.stringify(row));
  ambiguous.identities.push({
    ...ambiguous.identities[0],
    id: "serial-identity-two",
    fingerprint_sha256: "f".repeat(64),
  });
  equal(
    chooseRegistryMatch(blueSerialAi, [ambiguous]),
    null,
    "duplicate Blue /199 identities must remain ambiguous",
  );
});

test("verified sale count deduplicates immutable sale IDs", () => {
  const first = sale("same", 50);
  equal(independentVerifiedInstaCompSaleCount([first, { ...first, url: "https://example.test/duplicate" }], now), 1, "sale dedupe");
});

let failed = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`InstaComp 2.0 hardening simulations: ${tests.length - failed}/${tests.length} passed.`);
if (failed) process.exitCode = 1;
