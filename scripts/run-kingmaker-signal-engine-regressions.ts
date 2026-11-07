import assert from "node:assert/strict";
import { canonicalizeKingmakerObservation } from "../src/lib/kingmaker-intelligence-fusion";
import { compareKingmakerIdentity, extractKingmakerIdentity, scoreKingmakerSignal } from "../src/lib/kingmaker-signal-engine";

const now = new Date("2026-08-03T12:00:00.000Z");
function observation(input: {
  source: "ebay" | "mercari" | "poshmark" | "instacomp" | "purchase_ledger";
  key: string;
  type: string;
  amount: number;
  confidence?: number;
  observedAt?: string;
  evidence?: Record<string, unknown>;
}) {
  return canonicalizeKingmakerObservation({
    source: input.source,
    sourceRecordKey: input.key,
    entityKey: "hockey:2025:upper deck:ivan demidov:young guns:201:base:raw",
    observationType: input.type,
    observedAt: input.observedAt ?? "2026-08-03T10:00:00.000Z",
    expiresAt: "2026-08-06T10:00:00.000Z",
    confidence: input.confidence ?? 0.9,
    amount: input.amount,
    currency: "USD",
    directUrl: `https://example.com/${input.key}`,
    evidence: {
      category: "hockey",
      year: "2025",
      manufacturer: "Upper Deck",
      subject: "Ivan Demidov",
      set: "Young Guns",
      cardNumber: "201",
      parallel: "Base",
      raw: true,
      ...(input.evidence ?? {}),
    },
  });
}

const listing = observation({ source: "ebay", key: "listing", type: "delivered_cost", amount: 20 });
const sold = observation({ source: "instacomp", key: "sold", type: "sold_comp", amount: 45, confidence: 0.95 });
const market = observation({ source: "mercari", key: "market", type: "market_value", amount: 42, confidence: 0.8 });

const listingIdentity = extractKingmakerIdentity(listing);
const soldIdentity = extractKingmakerIdentity(sold);
assert.equal(compareKingmakerIdentity(listingIdentity, soldIdentity).matches, true);

const verified = scoreKingmakerSignal({
  now,
  evidence: [
    { observation: listing, role: "primary", identity: listingIdentity },
    { observation: sold, role: "supporting", identity: soldIdentity },
    { observation: market, role: "supporting", identity: extractKingmakerIdentity(market) },
  ],
});
assert.equal(verified.status, "verified");
assert.equal(verified.expectedProfit, 22);
assert.equal(verified.roiPercent, 110);
assert.ok(verified.score > 50);
assert.equal(verified.blockers.length, 0);

const graded = observation({ source: "instacomp", key: "graded", type: "sold_comp", amount: 100, evidence: { raw: false, gradeCompany: "PSA", grade: "10" } });
const mismatch = compareKingmakerIdentity(listingIdentity, extractKingmakerIdentity(graded));
assert.equal(mismatch.matches, false);
assert.ok(mismatch.blockers.includes("raw_graded_mismatch"));

const mismatchedSignal = scoreKingmakerSignal({
  now,
  evidence: [
    { observation: listing, role: "primary", identity: listingIdentity },
    { observation: graded, role: "supporting", identity: extractKingmakerIdentity(graded) },
  ],
});
assert.equal(mismatchedSignal.status, "withheld");
assert.ok(mismatchedSignal.blockers.includes("raw_graded_mismatch"));

const stale = observation({ source: "mercari", key: "stale", type: "market_value", amount: 50, observedAt: "2026-07-01T10:00:00.000Z" });
const staleSignal = scoreKingmakerSignal({
  now,
  evidence: [
    { observation: listing, role: "primary", identity: listingIdentity },
    { observation: stale, role: "supporting", identity: extractKingmakerIdentity(stale) },
  ],
});
assert.equal(staleSignal.status, "expired");
assert.ok(staleSignal.blockers.includes("stale_or_invalid_evidence"));

const contradiction = observation({ source: "poshmark", key: "contradiction", type: "market_value", amount: 18, confidence: 0.9 });
const contradicted = scoreKingmakerSignal({
  now,
  evidence: [
    { observation: listing, role: "primary", identity: listingIdentity },
    { observation: sold, role: "supporting", identity: soldIdentity },
    { observation: contradiction, role: "contradicting", identity: extractKingmakerIdentity(contradiction) },
  ],
});
assert.ok(contradicted.contradictionPenalty > 0);
assert.ok(contradicted.confidence < verified.confidence);

const oneSource = scoreKingmakerSignal({
  now,
  evidence: [{ observation: listing, role: "primary", identity: listingIdentity }],
});
assert.equal(oneSource.status, "withheld");
assert.ok(oneSource.blockers.includes("insufficient_source_diversity"));
assert.ok(oneSource.blockers.includes("missing_market_value"));

const lowProfitComp = observation({ source: "instacomp", key: "low-profit", type: "sold_comp", amount: 22 });
const lowProfit = scoreKingmakerSignal({
  now,
  evidence: [
    { observation: listing, role: "primary", identity: listingIdentity },
    { observation: lowProfitComp, role: "supporting", identity: extractKingmakerIdentity(lowProfitComp) },
  ],
});
assert.equal(lowProfit.status, "withheld");
assert.ok(lowProfit.blockers.includes("profit_below_threshold"));
assert.ok(lowProfit.blockers.includes("roi_below_threshold"));

console.log("KINGMAKER signal engine regressions passed.");
