import {
  canonicalActiveMarketProofItemId,
  directCompetitorIdentityFailures,
  reconcileActiveMarketDirectProofs,
  type ActiveMarketDirectCompetitorProof,
} from "../src/lib/active-market-competitor-proof";

type Json = Record<string, any>;

type Scenario = {
  name: string;
  run: () => void;
};

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const targetTitle =
  "2023-24 Upper Deck Ice #FI-1 Cale Makar Frozen In Ice SEALED";
const identity = {
  player: "Cale Makar",
  year: "2023-24",
  setName: "Upper Deck Ice Frozen In Ice",
  parallel: null,
  cardNumber: "FI-1",
  printRun: null,
  isAuto: false,
  isRelic: false,
  isGraded: false,
};

function candidate(id: string, overrides: Json = {}): Json {
  return {
    legacyItemId: id,
    itemId: id,
    title: "2023-24 Upper Deck Ice Frozen In Ice UNRIPPED Cale Makar #FI-1",
    price: 20,
    shippingCost: 4.99,
    shippingKnown: true,
    shippingCostType: "Fixed",
    landedPrice: 24.99,
    fixedPrice: true,
    matchScore: 96,
    matchLevel: "exact",
    url: `https://www.ebay.com/itm/${id}`,
    ...overrides,
  };
}

function proof(
  id: string,
  overrides: Partial<ActiveMarketDirectCompetitorProof> = {},
): ActiveMarketDirectCompetitorProof {
  return {
    itemId: id,
    confirmed: true,
    source: "browse_direct",
    checkedAt: "2026-07-24T23:10:00.000Z",
    title: "2023-24 Upper Deck Ice Frozen In Ice UNRIPPED Cale Makar #FI-1",
    evidenceText:
      "2023-24 Upper Deck Ice Frozen In Ice UNRIPPED Cale Makar #FI-1 | Player Cale Makar | Card Number FI-1 | Season 2023-24",
    price: 18,
    shippingCost: 3.99,
    shippingKnown: true,
    shippingCostType: "Fixed",
    landedPrice: 21.99,
    url: `https://www.ebay.com/itm/${id}`,
    listingStatus: "Active",
    fixedPrice: true,
    failureCode: null,
    failureMessage: null,
    ...overrides,
  };
}

function attack(competitors: Json[], overrides: Json = {}): Json {
  return {
    packagingState: "sealed",
    ourItemPrice: 30,
    ourShipping: 6.99,
    profitFloor: null,
    exactActiveCount: competitors.length,
    strictExactCount: competitors.length,
    strongMatchCount: 0,
    competitors,
    scoutingCount: 0,
    scoutingCandidates: [],
    packagingRejectedCount: 0,
    packagingRejectedCandidates: [],
    lowestCompetitor: competitors[0] || null,
    lowestCompetitorLanded: competitors[0]?.landedPrice ?? null,
    suggestions: competitors.length ? [{ key: "old" }] : [],
    gapToLowest: competitors.length ? 12 : null,
    ...overrides,
  };
}

const scenarios: Scenario[] = [
  {
    name: "confirmed direct proof keeps competitor and refreshes price",
    run() {
      const result = reconcileActiveMarketDirectProofs({
        attack: attack([candidate("111111111111")]),
        targetTitle,
        identity,
        proofs: [proof("111111111111")],
      });
      assert(result.attack.exactActiveCount === 1, "Expected one verified competitor");
      assert(result.attack.competitors[0]?.price === 18, "Expected direct price");
      assert(result.attack.lowestCompetitorLanded === 21.99, "Expected direct landed price");
      assert(result.attack.competitors[0]?.directProofConfirmed === true, "Expected direct proof marker");
      assert(result.attack.suggestions.length === 5, "Expected rebuilt strategies");
    },
  },
  {
    name: "missing direct proof demotes competitor to scouting",
    run() {
      const result = reconcileActiveMarketDirectProofs({
        attack: attack([candidate("222222222222")]),
        targetTitle,
        identity,
        proofs: [],
      });
      assert(result.attack.exactActiveCount === 0, "Unproved listing cannot price");
      assert(result.attack.scoutingCount === 1, "Expected review-only demotion");
      assert(result.attack.suggestions.length === 0, "No strategies without proved competitor");
      assert(
        result.attack.scoutingCandidates[0]?.flags.includes("direct_item_proof_missing"),
        "Expected direct-proof-missing flag",
      );
    },
  },
  {
    name: "failed direct lookup demotes competitor",
    run() {
      const failed = proof("333333333333", {
        confirmed: false,
        source: "none",
        title: null,
        evidenceText: null,
        price: null,
        shippingCost: null,
        shippingKnown: false,
        landedPrice: null,
        url: null,
        listingStatus: null,
        fixedPrice: null,
        failureCode: "direct_item_proof_request_failed",
        failureMessage: "timeout",
      });
      const result = reconcileActiveMarketDirectProofs({
        attack: attack([candidate("333333333333")]),
        targetTitle,
        identity,
        proofs: [failed],
      });
      assert(result.attack.exactActiveCount === 0, "Failed direct proof cannot price");
      assert(result.proofFailures.length === 1, "Expected proof failure evidence");
    },
  },
  {
    name: "direct RIPPED title becomes packaging rejection",
    run() {
      const result = reconcileActiveMarketDirectProofs({
        attack: attack([candidate("444444444444")]),
        targetTitle,
        identity,
        proofs: [
          proof("444444444444", {
            title: "2023-24 Upper Deck Ice Frozen In Ice RIPPED Cale Makar #FI-1",
            evidenceText:
              "2023-24 Upper Deck Ice Frozen In Ice RIPPED Cale Makar #FI-1 | Season 2023-24",
          }),
        ],
      });
      assert(result.attack.exactActiveCount === 0, "RIPPED direct proof cannot price sealed target");
      assert(result.attack.packagingRejectedCount === 1, "Expected packaging rejection");
      assert(result.attack.scoutingCount === 0, "RIPPED must not remain scouting");
    },
  },
  {
    name: "direct wrong player demotes competitor",
    run() {
      const result = reconcileActiveMarketDirectProofs({
        attack: attack([candidate("555555555555")]),
        targetTitle,
        identity,
        proofs: [
          proof("555555555555", {
            title: "2023-24 Upper Deck Ice Frozen In Ice UNRIPPED Nathan MacKinnon #FI-1",
            evidenceText:
              "2023-24 Upper Deck Ice Frozen In Ice UNRIPPED Nathan MacKinnon #FI-1 | Player Nathan MacKinnon",
          }),
        ],
      });
      assert(result.attack.exactActiveCount === 0, "Wrong player cannot price");
      assert(
        result.attack.scoutingCandidates[0]?.flags.includes("direct_item_player_mismatch"),
        "Expected player mismatch reason",
      );
    },
  },
  {
    name: "direct wrong card number demotes competitor",
    run() {
      const result = reconcileActiveMarketDirectProofs({
        attack: attack([candidate("666666666666")]),
        targetTitle,
        identity,
        proofs: [
          proof("666666666666", {
            title: "2023-24 Upper Deck Ice Frozen In Ice UNRIPPED Cale Makar #FI-9",
            evidenceText:
              "2023-24 Upper Deck Ice Frozen In Ice UNRIPPED Cale Makar #FI-9 | Card Number FI-9",
          }),
        ],
      });
      assert(result.attack.exactActiveCount === 0, "Wrong card number cannot price");
      assert(
        result.attack.scoutingCandidates[0]?.flags.includes("direct_item_card_number_mismatch"),
        "Expected card number mismatch",
      );
    },
  },
  {
    name: "direct numbered variant conflicts with unnumbered target",
    run() {
      const result = reconcileActiveMarketDirectProofs({
        attack: attack([candidate("777777777777")]),
        targetTitle,
        identity,
        proofs: [
          proof("777777777777", {
            evidenceText:
              "2023-24 Upper Deck Ice Frozen In Ice UNRIPPED Cale Makar #FI-1 numbered /99",
          }),
        ],
      });
      assert(result.attack.exactActiveCount === 0, "Numbered variant cannot price unnumbered target");
      assert(
        result.attack.scoutingCandidates[0]?.flags.includes("direct_item_numbered_variant_conflict"),
        "Expected numbered variant reason",
      );
    },
  },
  {
    name: "direct graded card conflicts with raw target",
    run() {
      const result = reconcileActiveMarketDirectProofs({
        attack: attack([candidate("888888888888")]),
        targetTitle,
        identity,
        proofs: [
          proof("888888888888", {
            evidenceText:
              "2023-24 Upper Deck Ice Frozen In Ice UNRIPPED Cale Makar #FI-1 PSA 10",
          }),
        ],
      });
      assert(result.attack.exactActiveCount === 0, "Graded proof cannot price raw target");
      assert(
        result.attack.scoutingCandidates[0]?.flags.includes("direct_item_graded_raw_state_mismatch"),
        "Expected graded/raw mismatch",
      );
    },
  },
  {
    name: "direct auction proof is review only",
    run() {
      const result = reconcileActiveMarketDirectProofs({
        attack: attack([candidate("999999999991")]),
        targetTitle,
        identity,
        proofs: [proof("999999999991", { fixedPrice: false })],
      });
      assert(result.attack.exactActiveCount === 0, "Auction cannot price fixed-price market");
      assert(result.attack.scoutingCount === 1, "Auction should remain review-only");
    },
  },
  {
    name: "partial direct proof keeps only confirmed competitor",
    run() {
      const first = candidate("999999999992", { landedPrice: 30 });
      const second = candidate("999999999993", { landedPrice: 25 });
      const result = reconcileActiveMarketDirectProofs({
        attack: attack([first, second]),
        targetTitle,
        identity,
        proofs: [proof("999999999992", { landedPrice: 19.99, price: 16, shippingCost: 3.99 })],
      });
      assert(result.attack.exactActiveCount === 1, "Only directly proved competitor may remain");
      assert(result.attack.scoutingCount === 1, "Unproved competitor should be scouting");
      assert(result.attack.lowestCompetitor.legacyItemId === "999999999992", "Expected proved leader");
    },
  },
  {
    name: "confirmed competitor with unknown shipping remains verified without strategies",
    run() {
      const result = reconcileActiveMarketDirectProofs({
        attack: attack([candidate("999999999994")]),
        targetTitle,
        identity,
        proofs: [
          proof("999999999994", {
            shippingCost: null,
            shippingKnown: false,
            landedPrice: null,
          }),
        ],
      });
      assert(result.attack.exactActiveCount === 1, "Direct proof can confirm identity with unknown shipping");
      assert(result.attack.landedKnownCount === 0, "Expected no known landed price");
      assert(result.attack.suggestions.length === 0, "Unknown shipping cannot create strategy");
      assert(result.attack.position === "shipping_unknown", "Expected shipping-unknown position");
    },
  },
];

assert(
  canonicalActiveMarketProofItemId({ itemId: "v1|123456789012|0" }) ===
    "123456789012",
  "Browse item ID should normalize to legacy ID",
);
assert(
  canonicalActiveMarketProofItemId({
    url: "https://www.ebay.com/itm/example/123456789012",
  }) === "123456789012",
  "Item URL should normalize to numeric ID",
);
assert(
  directCompetitorIdentityFailures({
    targetTitle,
    identity,
    evidenceText:
      "2023-24 Upper Deck Ice Frozen In Ice UNRIPPED Cale Makar #FI-1 | Player Cale Makar | Card Number FI-1",
  }).length === 0,
  "Exact direct evidence should have no identity failures",
);

const results: Array<{ name: string; status: "passed" | "failed"; error?: string }> = [];
for (const scenario of scenarios) {
  try {
    scenario.run();
    results.push({ name: scenario.name, status: "passed" });
  } catch (error) {
    results.push({
      name: scenario.name,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

for (const result of results) {
  console.log(
    `${result.status === "passed" ? "PASS" : "FAIL"} ${result.name}${
      result.error ? ` - ${result.error}` : ""
    }`,
  );
}

const failed = results.filter((result) => result.status === "failed");
console.log(
  `Active Market direct competitor proof simulations: ${results.length - failed.length}/${results.length} passed.`,
);
if (failed.length) process.exitCode = 1;
