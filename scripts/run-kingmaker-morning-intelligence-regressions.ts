import assert from "node:assert/strict";
import {
  buildKingmakerMorningIntelligence,
  fingerprintKingmakerMorningIntelligence,
  type KingmakerMorningIntelligenceInput,
} from "../src/lib/kingmaker-morning-intelligence";

const base: KingmakerMorningIntelligenceInput = {
  generatedAt: "2026-08-03T13:00:00.000Z",
  truthReady: true,
  truthWarnings: [],
  actionableDeals: [],
  meaningfulChanges: [],
  portfolioMovements: [],
  systemWarnings: [],
};

const noChange = buildKingmakerMorningIntelligence(base);
assert.equal(noChange.mode, "compact");
assert.equal(noChange.shouldDeliver, false);
assert.equal(noChange.reason, "no_material_change");

const withheld = buildKingmakerMorningIntelligence({
  ...base,
  truthReady: false,
  truthWarnings: ["Purchase Ledger reconciliation incomplete"],
  actionableDeals: [
    {
      key: "deal-1",
      title: "Do not publish this buy",
      detail: "Truth is restricted",
      severity: "action",
    },
  ],
});
assert.equal(withheld.mode, "withheld");
assert.equal(withheld.shouldDeliver, true);
assert.equal(withheld.actionableDeals.length, 0);
assert.match(withheld.subject, /WARNING/);

const materialInput: KingmakerMorningIntelligenceInput = {
  ...base,
  actionableDeals: [
    {
      key: "ebay-123",
      title: "Exact card below buy ceiling",
      detail: "Expected net profit $42.00",
      href: "https://example.test/listing/123",
      severity: "action",
      expectedProfit: 42,
      roiPercent: 38.4,
      confidence: 0.92,
      observedAt: "2026-08-03T12:59:00.000Z",
    },
  ],
};
const material = buildKingmakerMorningIntelligence(materialInput);
assert.equal(material.mode, "full");
assert.equal(material.shouldDeliver, true);
assert.equal(material.reason, "material_change");
assert.equal(material.actionableDeals.length, 1);

const fingerprintA = fingerprintKingmakerMorningIntelligence(materialInput);
const fingerprintB = fingerprintKingmakerMorningIntelligence({
  ...materialInput,
  generatedAt: "2030-01-01T00:00:00.000Z",
  actionableDeals: materialInput.actionableDeals.map((item) => ({
    ...item,
    observedAt: "2030-01-01T00:00:00.000Z",
  })),
});
assert.equal(
  fingerprintA,
  fingerprintB,
  "volatile timestamps must not defeat duplicate suppression",
);

const duplicate = buildKingmakerMorningIntelligence({
  ...materialInput,
  previousFingerprint: fingerprintA,
});
assert.equal(duplicate.mode, "compact");
assert.equal(duplicate.shouldDeliver, false);
assert.equal(duplicate.reason, "duplicate_suppressed");

const forced = buildKingmakerMorningIntelligence({
  ...base,
  forceFull: true,
});
assert.equal(forced.mode, "full");
assert.equal(forced.shouldDeliver, true);
assert.equal(forced.reason, "forced_full");

console.log("KINGMAKER morning intelligence regressions passed.");
