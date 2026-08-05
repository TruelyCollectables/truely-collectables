import { readFileSync } from "node:fs";
import type { InstaCompAiResult, InstaCompComp } from "../src/lib/instacomp";
import {
  assertInstaCompChannelDraftParity,
  buildInstaCompChannelDraft,
} from "../src/lib/instacomp-channel-draft";
import {
  applyInstaCompListingOutput,
  buildInstaCompListingOutput,
  type InstaCompAiInscriptionFields,
} from "../src/lib/instacomp-listing-output";
import {
  isVerifiedInstaCompCompletedSale,
  verifiedInstaCompCompletedSales,
} from "../src/lib/instacomp-market-evidence";
import { buildInstaCompScanReview } from "../src/lib/instacomp-scan-review";
import { getInventoryActivationBlockers } from "../src/lib/inventory-activation";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requireText(source: string, expected: string, message: string) {
  assert(source.includes(expected), message);
}

function requireOrder(
  source: string,
  first: string,
  second: string,
  message: string,
) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert(
    firstIndex >= 0 && secondIndex >= 0 && firstIndex < secondIndex,
    message,
  );
}

function ai(
  overrides: Partial<InstaCompAiResult & InstaCompAiInscriptionFields> = {},
): InstaCompAiResult & InstaCompAiInscriptionFields {
  return {
    player: "Connor Bedard",
    year: "2024-25",
    brand: "Upper Deck",
    setName: "Series One",
    cardNumber: "1",
    parallel: "Base",
    serialNumber: null,
    gradingCompany: null,
    gradeValue: null,
    certificationNumber: null,
    certificationLookupUrl: null,
    gradingEvidence: null,
    team: "Chicago Blackhawks",
    sport: "Hockey",
    isRookie: false,
    isAuto: false,
    isRelic: false,
    conditionGuess: "Near Mint or Better",
    confidence: 0.99,
    notes: null,
    isInscribed: false,
    inscriptionText: null,
    inscriptionConfidence: null,
    ...overrides,
  };
}

function draft(params: {
  ai: InstaCompAiResult & InstaCompAiInscriptionFields;
  baseTitle: string;
  condition?: string;
}) {
  const output = buildInstaCompListingOutput({ ai: params.ai });
  const listing = applyInstaCompListingOutput({
    baseTitle: params.baseTitle,
    baseDescription:
      "Registry-locked InstaComp scan. Review all listing facts before publishing.",
    output,
  });
  const channelDraft = assertInstaCompChannelDraftParity(
    buildInstaCompChannelDraft({
      registryIdentityId: "registry-test-identity",
      registryFingerprintSha256: "f".repeat(64),
      content: {
        title: listing.title,
        description: listing.description,
        condition: params.condition || "Ungraded",
        quantity: 1,
      },
      listingOutput: output,
    }),
  );
  return { output, listing, channelDraft };
}

const base = draft({
  ai: ai(),
  baseTitle: "2024-25 Upper Deck Series One Connor Bedard #1 Base",
});
assert(base.output.publicationStatus === "ready", "normal base card must be ready");
assert(base.channelDraft.contentParity === true, "base channel parity failed");
assert(
  base.channelDraft.website.title === base.channelDraft.ebay.title &&
    base.channelDraft.website.description === base.channelDraft.ebay.description,
  "website and eBay content diverged",
);
assert(
  base.channelDraft.sellerReviewRequired === true &&
    base.channelDraft.executableByInstaComp === false,
  "channel draft bypassed seller review",
);

const serial = draft({
  ai: ai({
    player: "Example Serial Player",
    setName: "Serial Parallel",
    cardNumber: "49",
    parallel: "Blue Foil",
    serialNumber: "049/999",
  }),
  baseTitle:
    "2024-25 Upper Deck Serial Parallel Example Serial Player #49 Blue Foil",
});
assert(serial.output.serial?.exact === "049/999", "exact copy number was not preserved");
assert(serial.listing.title.includes("049/999"), "serial copy missing from title");
assert(serial.listing.description.includes("049/999"), "serial copy missing from description");
assert(!serial.listing.title.includes("/50"), "copy number incorrectly inferred a /50 print run");

const auto = draft({
  ai: ai({
    player: "Example Autograph Player",
    setName: "Signature Series",
    cardNumber: "A1",
    parallel: "Autograph",
    isAuto: true,
  }),
  baseTitle:
    "2024-25 Upper Deck Signature Series Example Autograph Player #A1 Auto",
});
assert(auto.channelDraft.website.title.includes("Auto"), "autograph configuration was lost");

const relic = draft({
  ai: ai({
    player: "Example Relic Player",
    setName: "Game Materials",
    cardNumber: "GM1",
    parallel: "Jersey",
    isRelic: true,
  }),
  baseTitle:
    "2024-25 Upper Deck Game Materials Example Relic Player #GM1 Jersey Relic",
});
assert(relic.channelDraft.website.title.includes("Relic"), "memorabilia configuration was lost");

const rookie = draft({
  ai: ai({
    player: "Example Rookie",
    setName: "Rookie Set",
    cardNumber: "RC1",
    isRookie: true,
  }),
  baseTitle: "2024-25 Upper Deck Rookie Set Example Rookie #RC1 Rookie",
});
assert(rookie.channelDraft.website.title.includes("Rookie"), "rookie evidence was lost");

const confirmedInscription = draft({
  ai: ai({
    player: "Shea Theodore",
    setName: "Signature Auto",
    cardNumber: "ST",
    parallel: "Autograph",
    isAuto: true,
    isInscribed: true,
    inscriptionText: "VGK Jackpot",
    inscriptionConfidence: 0.97,
  }),
  baseTitle: "2024-25 Upper Deck Shea Theodore #ST Auto",
});
assert(
  confirmedInscription.listing.title.includes("Inscribed"),
  "confirmed inscription title token was lost",
);
assert(
  confirmedInscription.listing.description.includes("VGK Jackpot"),
  "exact inscription text was lost",
);

const unreadableInscription = draft({
  ai: ai({
    player: "Unreadable Inscription Player",
    isInscribed: true,
    inscriptionText: null,
    inscriptionConfidence: 0.3,
  }),
  baseTitle: "2024-25 Upper Deck Unreadable Inscription Player #1 Base",
});
assert(
  unreadableInscription.output.publicationStatus === "review_required",
  "unreadable inscription must require review",
);
assert(
  !unreadableInscription.listing.title.includes("Inscribed"),
  "unreadable inscription was advertised",
);
const unreadableBlockers = getInventoryActivationBlockers({
  sku: "TEST-UNREADABLE",
  price: 25,
  quantity: 1,
  imageUrl: "https://example.com/card.jpg",
  title: unreadableInscription.listing.title,
  category: "Trading Card Singles",
  metadata: {
    instacomp: {
      publicationStatus: unreadableInscription.output.publicationStatus,
      listingOutput: unreadableInscription.output,
    },
  },
});
assert(
  unreadableBlockers.includes("instacomp_listing_review_required"),
  "unreadable listing evidence did not block publication",
);

const gradedBlockers = getInventoryActivationBlockers({
  sku: "TEST-GRADED",
  price: 100,
  quantity: 1,
  imageUrl: "https://example.com/slab.jpg",
  title: "2024-25 Upper Deck Example Player PSA 10",
  category: "Trading Card Singles",
  metadata: {
    collectible_asset: {
      grading_company: "PSA",
      grading_grade: "10",
      grading_cert_number: "12345678",
      grader_verification_status: "required",
    },
  },
});
assert(
  gradedBlockers.includes("grader_verification_required"),
  "unverified graded scan did not remain blocked",
);

const multiSubject = draft({
  ai: ai({
    player: "Player One / Player Two",
    setName: "Dual Signatures",
    cardNumber: "DS1",
  }),
  baseTitle: "2024-25 Upper Deck Dual Signatures Player One / Player Two #DS1",
});
assert(
  multiSubject.channelDraft.website.title.includes("Player One / Player Two"),
  "multi-subject identity was collapsed",
);

const unclearReview = buildInstaCompScanReview({
  ai: ai({ parallel: "possibly gold", confidence: 0.7 }),
  stats: {
    low: null,
    median: null,
    average: null,
    high: null,
    suggestedPrice: null,
  },
  marketValueComps: [],
  hasBackImage: true,
  pairingConfidence: 0.99,
});
assert(unclearReview.status === "review_required", "unclear identity did not fail closed");
assert(
  unclearReview.identityReviewReasons.includes("low_identification_confidence") &&
    unclearReview.identityReviewReasons.includes("parallel_needs_review"),
  "unclear identity blockers were incomplete",
);

const soldComp = (id: string, price: number): InstaCompComp & {
  saleId: string;
  saleVerified: true;
  finalPriceVerified: true;
  shippingVerified: true;
} => ({
  title: `Verified completed sale ${id}`,
  price,
  itemPrice: price - 5,
  shippingPrice: 5,
  priceIncludesShipping: true,
  currency: "USD",
  url: `https://www.ebay.com/itm/${id}`,
  imageUrl: null,
  source: "ebay",
  sourceLabel: "eBay sold",
  sourceCategory: "sold",
  matchScore: 100,
  flags: [],
  soldAt: "2026-08-01T12:00:00.000Z",
  saleId: id,
  saleVerified: true,
  finalPriceVerified: true,
  shippingVerified: true,
});
const completedSales = [
  soldComp("123456789001", 105),
  soldComp("123456789002", 115),
];
const activeAsk = {
  ...soldComp("123456789003", 150),
  sourceCategory: "marketplace",
  sourceLabel: "eBay active",
  soldAt: null,
};
assert(
  verifiedInstaCompCompletedSales(completedSales).length === 2,
  "verified sold evidence was not retained",
);
assert(
  isVerifiedInstaCompCompletedSale(activeAsk) === false,
  "active asking price was treated as a completed sale",
);

const intakeSource = readFileSync(
  "src/app/api/account/seller/instacomp-scan/intake/route.ts",
  "utf8",
);
const publishSource = readFileSync(
  "src/app/api/account/seller/instacomp-pending/publish/route.ts",
  "utf8",
);
const pendingSource = readFileSync(
  "src/app/seller/instacomp-pending/page.tsx",
  "utf8",
);
const scannerSource = readFileSync(
  "src/app/seller/instacomp-scan/page.tsx",
  "utf8",
);
const kingmakerScan = readFileSync(
  "src/app/kingmaker/scan/page.tsx",
  "utf8",
);
const kingmakerPending = readFileSync(
  "src/app/kingmaker/pending/page.tsx",
  "utf8",
);
const kingmakerFrontBackRoute = readFileSync(
  "src/app/api/account/seller/inventory/instacomp-front-back/route.ts",
  "utf8",
);
const kingmakerEditRoute = readFileSync(
  "src/app/api/account/seller/inventory/instacomp-card-edit/route.ts",
  "utf8",
);

for (const required of [
  "buildInstaCompListingOutput",
  "applyInstaCompListingOutput",
  "buildInstaCompChannelDraft",
  "publicationReviewReasons",
  "grading_company",
  "grading_grade",
  "grading_cert_number",
  "exact_serial_number",
  "rookie:",
  "autograph:",
  "memorabilia:",
]) {
  requireText(intakeSource, required, `scanner intake is missing ${required}`);
}
requireOrder(
  intakeSource,
  'code: "CHECKLIST_IDENTITY_REQUIRED"',
  '.contains("metadata"',
  "Registry verification must precede duplicate checking",
);
requireOrder(
  intakeSource,
  '.contains("metadata"',
  "const listingOutput = buildInstaCompListingOutput",
  "duplicate checking must precede draft generation",
);
requireOrder(
  intakeSource,
  "const listingOutput = buildInstaCompListingOutput",
  ".insert({",
  "listing output must be persisted with the inventory draft",
);
requireOrder(
  intakeSource,
  ".insert({",
  "await runVerifiedPricing(pricingRequest)",
  "verified pricing must run only after the Registry-locked draft exists",
);

for (const required of [
  "confirmIdentity !== true",
  "assertChecklistRegistryReceipt",
  "getInventoryActivationBlockers",
  'status: "active"',
]) {
  requireText(publishSource, required, `publish firewall is missing ${required}`);
}
requireText(pendingSource, "soldCompEvidence", "Pending Listings lost sold evidence");
requireText(
  pendingSource,
  "activeCompetition",
  "Pending Listings lost separate active competition",
);
requireText(scannerSource, 'capture="environment"', "phone camera capture is missing");
requireText(scannerSource, "front", "front image capture is missing");
requireText(scannerSource, "back", "back image capture is missing");
requireText(
  kingmakerScan.trim(),
  'export { default } from "../../seller/instacomp-scan/page";',
  "KINGMAKER scanner no longer wraps the canonical seller scanner",
);
for (const required of [
  "rotatedImageFile",
  'formData.set("frontImage", frontImage)',
  'formData.set("backImage", backImage)',
  "Retry This Card",
  "Replace Manual Identity with AI",
  "job?.error",
]) {
  requireText(
    kingmakerPending,
    required,
    `KINGMAKER audited Pending Listings is missing ${required}`,
  );
}
assert(
  !kingmakerPending.includes("failed: 100"),
  "KINGMAKER Pending Listings restored fake Failed 100 percent progress",
);
for (const required of [
  "DUPLICATE_IMAGE_BYTES",
  "manualIdentityLocked",
  "backEvidenceText",
  "identity_complete_pricing_pending",
  "setNamePreserved: true",
]) {
  requireText(
    kingmakerFrontBackRoute,
    required,
    `front/back identity route is missing ${required}`,
  );
}
for (const required of [
  "manualIdentityLocked: true",
  "identityRefreshRequired: false",
  "manual_identity_saved_pricing_pending",
]) {
  requireText(
    kingmakerEditRoute,
    required,
    `seller identity edit route is missing ${required}`,
  );
}

console.log(
  JSON.stringify(
    {
      schema: "tcos.instacomp.scan-to-list-release-gate.v2",
      status: "passed",
      representativeCases: [
        "base",
        "serial_numbered",
        "autograph",
        "relic",
        "rookie",
        "confirmed_inscription",
        "unreadable_inscription",
        "graded",
        "multi_subject",
        "intentionally_unclear",
      ],
      exactCopyPreserved: serial.output.serial?.exact,
      inferredPrintRun: false,
      websiteEbayContentParity: true,
      soldEvidenceSeparatedFromActiveAsks: true,
      registryBeforeDraft: true,
      duplicateBeforeDraft: true,
      verifiedPricingAfterDraft: true,
      sellerReviewRequired: true,
      publishFirewall: true,
      kingmakerFrontBackJobCertified: true,
      manualIdentityLockCertified: true,
      livePhysicalAcceptancePassed: false,
      betaOnePassed: false,
    },
    null,
    2,
  ),
);
