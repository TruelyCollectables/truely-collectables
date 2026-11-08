import type { InstaCompAiResult } from "../src/lib/instacomp";
import {
  applyInstaCompListingOutput,
  buildInstaCompListingOutput,
  type InstaCompAiInscriptionFields,
} from "../src/lib/instacomp-listing-output";
import { buildInstaCompScanReview } from "../src/lib/instacomp-scan-review";

function ai(
  overrides: Partial<InstaCompAiResult & InstaCompAiInscriptionFields> = {},
): InstaCompAiResult & InstaCompAiInscriptionFields {
  return {
    player: "Shea Theodore",
    year: "2024-25",
    brand: "Upper Deck",
    setName: "Signature Auto",
    cardNumber: "ST",
    parallel: "Autograph",
    serialNumber: null,
    team: "Vegas Golden Knights",
    sport: "Hockey",
    isRookie: false,
    isAuto: true,
    isRelic: false,
    conditionGuess: "Near Mint or Better",
    confidence: 0.99,
    notes: null,
    ...overrides,
  };
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const shea = buildInstaCompListingOutput({
  ai: ai({
    isInscribed: true,
    inscriptionText: "VGK Jackpot",
    inscriptionConfidence: 0.97,
  }),
});
assert(shea.universalInscription.status === "confirmed", "Shea inscription must confirm");
assert(shea.universalInscription.inscriptionText === "VGK Jackpot", "Shea inscription text lost");
assert(shea.titleTokens.includes("Inscribed"), "confirmed inscription must add title token");
assert(
  shea.sellerDescriptionFacts.includes("Hand inscription: VGK Jackpot"),
  "confirmed inscription must reach seller description",
);
assert(shea.publicationStatus === "ready", "high-confidence inscription should be ready");

const payload = applyInstaCompListingOutput({
  baseTitle: "2024-25 Upper Deck Shea Theodore Auto",
  baseDescription: "Authentic card shown in photos.",
  output: shea,
});
assert(payload.title.includes("Inscribed"), "listing title omitted Inscribed");
assert(payload.description.includes("VGK Jackpot"), "listing description omitted exact inscription");

const sameCardWithoutInscription = buildInstaCompListingOutput({ ai: ai() });
assert(!sameCardWithoutInscription.titleTokens.includes("Inscribed"), "non-inscribed copy was mislabeled");
assert(
  !sameCardWithoutInscription.sellerDescriptionFacts.some((fact) => fact.includes("Hand inscription")),
  "non-inscribed copy received inscription text",
);

const notesEvidence = buildInstaCompListingOutput({
  ai: ai({ notes: "Inscription: VGK Jackpot" }),
});
assert(notesEvidence.universalInscription.inscriptionText === "VGK Jackpot", "labeled AI notes were not normalized");

const ocrEvidence = buildInstaCompListingOutput({
  ai: ai(),
  externalOcrText: "Inscribed: VGK Jackpot",
});
assert(ocrEvidence.universalInscription.source === "ocr", "OCR inscription source lost");
assert(ocrEvidence.universalInscription.inscriptionText === "VGK Jackpot", "OCR inscription text lost");

const unreadable = buildInstaCompListingOutput({
  ai: ai({ isInscribed: true, inscriptionText: null, inscriptionConfidence: 0.4 }),
});
assert(unreadable.publicationStatus === "review_required", "unreadable inscription must block publication");
assert(
  unreadable.publicationReviewReasons.includes("inscription_observed_but_text_unreadable"),
  "unreadable inscription review reason missing",
);
assert(!unreadable.titleTokens.includes("Inscribed"), "unreadable inscription must not be advertised");

const lowConfidence = buildInstaCompListingOutput({
  ai: ai({
    isInscribed: true,
    inscriptionText: "VGK Jackpot",
    inscriptionConfidence: 0.61,
  }),
});
assert(lowConfidence.publicationStatus === "review_required", "low-confidence inscription must block publication");
assert(
  lowConfidence.publicationReviewReasons.includes("inscription_text_low_confidence"),
  "low-confidence reason missing",
);

const futureWatch = buildInstaCompListingOutput({
  ai: ai({
    player: "Example Rookie",
    brand: "SP Authentic",
    setName: "Future Watch Autographs",
    parallel: "Future Watch Auto",
    serialNumber: "49/999",
    notes: "Inscribed debut date: 10/12/2025",
    isInscribed: true,
    inscriptionText: "10/12/2025",
    inscriptionConfidence: 0.99,
  }),
});
assert(futureWatch.titleSuffix.includes("Future Watch Auto"), "Future Watch overlay lost");
assert(futureWatch.titleSuffix.includes("Inscribed"), "Future Watch confirmed inscription lost");
assert(
  futureWatch.sellerDescriptionFacts.some((fact) => fact.includes("10/12/2025")),
  "Future Watch inscription date lost",
);

const scanReview = buildInstaCompScanReview({
  ai: ai({ isInscribed: true, inscriptionText: null, inscriptionConfidence: 0.4 }),
  stats: { low: null, median: null, average: null, high: null, suggestedPrice: null },
  marketValueComps: [],
  hasBackImage: true,
  pairingConfidence: 0.99,
});
assert(
  scanReview.identityReviewReasons.includes("inscription_observed_but_text_unreadable"),
  "scan review did not inherit inscription publication blocker",
);

console.log(
  JSON.stringify(
    {
      status: "passed",
      confirmed: shea.universalInscription,
      noInscription: sameCardWithoutInscription.universalInscription,
      unreadable: unreadable.universalInscription,
      futureWatch: futureWatch.universalInscription,
      listingPayload: payload,
    },
    null,
    2,
  ),
);
