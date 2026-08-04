import type { InstaCompAiResult } from "../src/lib/instacomp";
import {
  buildInstaCompListingIdentity,
  classifyInstaCompInscriptionCopy,
} from "../src/lib/instacomp-copy-identity";
import { buildInstaCompScanReview } from "../src/lib/instacomp-scan-review";

function ai(overrides: Partial<InstaCompAiResult>): InstaCompAiResult {
  return {
    player: "Example Rookie",
    year: "2025-26",
    brand: "SP Authentic",
    setName: "Future Watch Autographs",
    cardNumber: "101",
    parallel: "Future Watch Auto",
    serialNumber: "49/999",
    team: "Example Team",
    sport: "Hockey",
    isRookie: true,
    isAuto: true,
    isRelic: false,
    conditionGuess: "Near Mint or Better",
    confidence: 0.99,
    notes: "Inscribed debut date: 10/12/2025",
    ...overrides,
  };
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

for (const copy of [1, 49, 50]) {
  const result = classifyInstaCompInscriptionCopy(
    ai({ serialNumber: `${copy}/999`, notes: "NHL debut: 10/12/2025" }),
  );
  assert(result.status === "inscribed_confirmed", `${copy}/999 must be inscribed`);
  assert(result.inscriptionExpected, `${copy}/999 must expect inscription`);
  assert(result.debutDate === "10/12/2025", `${copy}/999 lost debut date`);
  assert(result.serial?.copyNumber === copy, `${copy}/999 lost numerator`);
  assert(result.serial?.printRun === 999, `${copy}/999 lost denominator`);
}

for (const copy of [51, 250, 999]) {
  const result = classifyInstaCompInscriptionCopy(
    ai({ serialNumber: `${copy}/999`, notes: null }),
  );
  assert(result.status === "standard_copy", `${copy}/999 must be standard`);
  assert(!result.inscriptionExpected, `${copy}/999 cannot inherit first-50 inscription`);
}

const unread = classifyInstaCompInscriptionCopy(
  ai({ serialNumber: "05/999", notes: null }),
);
assert(
  unread.status === "inscribed_expected_needs_read",
  "first-50 copy without readable date must stop automatic listing",
);
assert(
  unread.reviewReasons.includes("expected_debut_date_inscription_not_read"),
  "missing debut-date review reason was not emitted",
);

const conflict = classifyInstaCompInscriptionCopy(
  ai({ serialNumber: "250/999", notes: "Inscribed debut date: 10/12/2025" }),
);
assert(conflict.status === "inscription_conflict", "copy above 50 must flag conflict");
assert(
  conflict.reviewReasons.includes("future_watch_copy_above_50_claims_inscription"),
  "copy-above-50 conflict reason missing",
);

const wrongRun = classifyInstaCompInscriptionCopy(
  ai({ serialNumber: "25/100", notes: "NHL debut: 10/12/2025" }),
);
assert(wrongRun.status === "not_applicable", "non-/999 issue must not use Future Watch rule");

const wrongSet = classifyInstaCompInscriptionCopy(
  ai({ setName: "Sign of the Times", parallel: "Autograph", serialNumber: "25/999" }),
);
assert(wrongSet.status === "not_applicable", "other autograph sets must not use Future Watch rule");

const listing = buildInstaCompListingIdentity(ai({ serialNumber: "49/999" }));
assert(
  listing.titleSuffix === "Future Watch Auto Inscribed 49/999",
  `unexpected listing suffix: ${listing.titleSuffix}`,
);
assert(
  listing.descriptionFacts.includes("Hand-inscribed debut date: 10/12/2025"),
  "listing description omitted debut date",
);
assert(listing.safeForAutomaticListing, "confirmed inscription should be listing-safe");

const blockedListing = buildInstaCompListingIdentity(
  ai({ serialNumber: "50/999", notes: null }),
);
assert(!blockedListing.safeForAutomaticListing, "unread first-50 inscription must block auto listing");
assert(
  blockedListing.titleSuffix === "Future Watch Auto 50/999",
  "unconfirmed inscription must not be advertised in title",
);

const review = buildInstaCompScanReview({
  ai: ai({ serialNumber: "05/999", notes: null }),
  stats: { low: null, median: null, average: null, high: null, suggestedPrice: null },
  marketValueComps: [],
  hasBackImage: true,
  pairingConfidence: 0.99,
  externalOcrText: "05/999",
});
assert(
  review.identityReviewReasons.includes("expected_debut_date_inscription_not_read"),
  "scan review must expose first-50 inscription blocker",
);
assert(review.listingIdentity.serial?.copyNumber === 5, "scan review lost exact copy number");

const padded = buildInstaCompListingIdentity(ai({ serialNumber: "001/999" }));
assert(padded.serial?.copyNumber === 1, "padded numerator must normalize numerically");
assert(padded.serial?.exact === "001/999", "original serial display must be preserved");

console.log(
  JSON.stringify(
    {
      status: "passed",
      first50: ["1/999", "49/999", "50/999"],
      standard: ["51/999", "250/999", "999/999"],
      listing: listing,
      blockedListing: blockedListing,
    },
    null,
    2,
  ),
);
