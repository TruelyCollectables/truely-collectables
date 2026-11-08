import "server-only";

import { z } from "zod";
import {
  calculateDeliveredCost,
  calculateMaximumOffer,
  calculateResaleOutcome,
} from "../../connectors/tcos-market-intel-mcp/src/logic.mjs";
import {
  classifyProfitHunterOutcome,
  hardenedInstaCompService,
} from "../../connectors/tcos-market-intel-mcp/src/instacomp-bridge.mjs";
import { publicSearchService } from "../../connectors/tcos-market-intel-mcp/src/public-search.mjs";
import { checkProfitHunterOwnedPurchase } from "./tcos-profit-hunter-owned";
import {
  profitHunterLockedScope,
  TCOS_WNBA_ROOKIE_PLAYERS,
  validateProfitHunterIdentity,
} from "./tcos-profit-hunter-policy";

export const profitHunterLaneSchema = z.enum([
  "demidov",
  "wnba",
  "danny_norris",
  "baseball_prospect",
  "signed_baseball",
]);

const sellerRiskSchema = z.enum(["low", "medium", "high", "unknown"]);

const firstBowmanEvidenceSchema = z.object({
  checklistSource: z.string().min(2),
  checklistUrl: z.string().url(),
  exactCardNumber: z.string().min(1),
  chronologyChecked: z.boolean(),
  noEarlierQualifyingIssue: z.boolean(),
  notes: z.string().nullable().optional(),
});

const listingSchema = z.object({
  source: z.string().min(1),
  url: z.string().url(),
  sourceItemId: z.string().nullable().optional(),
  title: z.string().min(1),
  sellerName: z.string().nullable().optional(),
  askingPrice: z.number().nonnegative(),
  shipping: z.number().nonnegative().default(0),
  buyerFees: z.number().nonnegative().default(0),
  tax: z.number().nonnegative().default(0),
  frontImageUrl: z.string().url(),
  backImageUrl: z.string().url(),
});

export const profitHunterSearchSchema = z.object({
  lane: profitHunterLaneSchema,
  player: z.string().nullable().optional(),
  query: z.string().nullable().optional(),
  maxResults: z.number().int().min(1).max(50).default(20),
});

export const profitHunterVerifySchema = z.object({
  lane: profitHunterLaneSchema,
  expectedPlayer: z.string().nullable().optional(),
  listing: listingSchema,
  trueFirstBowmanEvidence: firstBowmanEvidenceSchema.nullable().optional(),
  sellerRisk: sellerRiskSchema.default("unknown"),
  manualReviewRequired: z.boolean().default(false),
  aiCouncilTier: z.string().default("adaptive"),
  operatorSerialNumberOverride: z.string().nullable().optional(),
  sellingFeeRate: z.number().min(0).max(1).default(0.1325),
  orderFee: z.number().nonnegative().default(0.4),
  paymentProcessingFees: z.number().nonnegative().default(0),
  outboundShipping: z.number().nonnegative().default(0.78),
  supplies: z.number().nonnegative().default(0.25),
  gradingAuthentication: z.number().nonnegative().default(0),
  cleaningPreparation: z.number().nonnegative().default(0),
  labor: z.number().nonnegative().default(0),
  returnReserveRate: z.number().min(0).max(1).default(0.02),
});

function lockedSearchRequest({ lane, player, query }) {
  const sources = [
    "eBay",
    "Mercari",
    "Whatnot Marketplace",
    "Sportslots",
    "COMC",
    "MySlabs",
    "Fanatics Collect",
    "CollX",
    "Facebook Marketplace",
    "public Facebook sales pages",
    "public X sale posts",
    "Etsy",
  ];

  if (lane === "demidov") {
    return {
      query:
        query ||
        "Ivan Demidov professional NHL rookie RC Young Guns rookie parallel numbered autograph memorabilia misspelling mislabeled",
      sources,
      filters: {
        player: "Ivan Demidov",
        professionalNhlRookieOnly: true,
        exactFrontBackRequiredForAction: true,
      },
    };
  }

  if (lane === "wnba") {
    const selectedPlayers = player ? [player] : [...TCOS_WNBA_ROOKIE_PLAYERS];
    for (const selected of selectedPlayers) {
      if (!TCOS_WNBA_ROOKIE_PLAYERS.includes(selected)) {
        throw new Error(`${selected} is outside the locked WNBA watchlist.`);
      }
    }
    return {
      query:
        query ||
        `${selectedPlayers.join(" ")} professional WNBA rookie Silver Prizm color numbered SSP case hit autograph memorabilia misspelling mislabeled`,
      sources,
      filters: {
        players: selectedPlayers,
        professionalWnbaRookieOnly: true,
        ordinaryBaseExcluded: true,
        minimumTier: "Silver Prizm or equivalent",
        collegeNcaaBowmanUniversityDraftPicksExcluded: true,
        exactFrontBackRequiredForAction: true,
      },
    };
  }

  if (lane === "danny_norris") {
    return {
      query:
        query ||
        `Danny Norris CollX ${TCOS_WNBA_ROOKIE_PLAYERS.join(" ")} WNBA rookie Silver color numbered autograph memorabilia misspelling mislabeled`,
      sources,
      filters: {
        sellerName: "Danny Norris",
        players: [...TCOS_WNBA_ROOKIE_PLAYERS],
        sellerInventorySweep: true,
        professionalWnbaRookieOnly: true,
        ordinaryBaseExcluded: true,
        minimumTier: "Silver Prizm or equivalent",
        collegeNcaaBowmanUniversityDraftPicksExcluded: true,
      },
    };
  }

  if (lane === "baseball_prospect") {
    if (!player && !query) {
      throw new Error("Baseball prospect discovery requires a player or search query.");
    }
    return {
      query:
        query ||
        `${player} true 1st Bowman Chrome refractor Sapphire color numbered autograph misspelling mislabeled`,
      sources,
      filters: {
        player: player || null,
        issueYearMinimum: 2021,
        trueFirstBowmanOnly: true,
        authoritativeChecklistRequiredBeforeAction: true,
        chronologyRequiredBeforeAction: true,
      },
    };
  }

  return {
    query:
      query ||
      `${player || "top baseball prospect"} signed baseball official MLB MiLB Futures Game Spring Training raw PSA DNA JSA Beckett BAS authentication upside`,
    sources: [
      ...sources,
      "MLB Auctions",
      "MiLB and team auctions",
      "Fanatics Authentic",
      "team stores",
      "autograph dealers",
      "estate and liquidation listings",
    ],
    filters: {
      player: player || null,
      signedBaseballOnly: true,
      rawSignaturesNeverCalledAuthentic: true,
      authenticationAndProvenanceReviewRequired: true,
    },
  };
}

export function getProfitHunterActionStatus() {
  return {
    ok: true,
    service: "TCOS Deal Hunter / Profit Hunter",
    interface: "GPT Actions REST",
    version: "1.0.0",
    scope: profitHunterLockedScope(),
    discovery: publicSearchService.status(),
    hardenedInstaComp: hardenedInstaCompService.status(),
    purchaseWritesEnabled: false,
  };
}

export async function searchProfitHunterAction(input) {
  const parsed = profitHunterSearchSchema.parse(input);
  const request = lockedSearchRequest(parsed);
  const discovery = await publicSearchService.search({
    ...request,
    maxResults: parsed.maxResults,
    exactIdentityOnly: false,
  });
  const candidates = discovery.results.map((candidate) => ({
    ...candidate,
    purchaseReady: false,
    requiresHardenedVerification: true,
    frontBackSelectionRequired: (candidate.imageUrls || []).length < 2,
  }));

  return {
    lane: parsed.lane,
    count: candidates.length,
    candidates,
    sourceReports: discovery.sourceReports,
    warnings: discovery.warnings,
  };
}

export async function verifyProfitHunterAction(input) {
  const parsed = profitHunterVerifySchema.parse(input);

  if (parsed.lane === "signed_baseball") {
    return {
      listing: parsed.listing,
      outcome: {
        label: "SUPPRESSED — MEMORABILIA REVIEW REQUIRED",
        purchaseReady: false,
        reason:
          "Signed baseballs use a separate authentication/provenance workflow and are not certified by the card scanner.",
      },
    };
  }

  const owned = await checkProfitHunterOwnedPurchase(parsed.listing.url);
  if (owned.owned) {
    return {
      listing: parsed.listing,
      ownedPurchaseExclusion: owned,
      outcome: {
        label: "SUPPRESSED — OWNED PURCHASE",
        purchaseReady: false,
        reason: owned.reason,
      },
    };
  }

  const scan = await hardenedInstaCompService.scanListing({
    frontImageUrl: parsed.listing.frontImageUrl,
    backImageUrl: parsed.listing.backImageUrl,
    aiCouncilTier: parsed.aiCouncilTier,
    operatorSerialNumberOverride: parsed.operatorSerialNumberOverride,
  });
  const policy = validateProfitHunterIdentity({
    lane: parsed.lane,
    expectedPlayer: parsed.expectedPlayer || null,
    identity: scan.ai || {},
    trueFirstBowmanEvidence: parsed.trueFirstBowmanEvidence || null,
  });

  const exactMarket = scan.exactMarket || {};
  const pricingEligibleSoldCount = Number(
    exactMarket.pricingEligibleSoldCount ?? scan.soldComps?.length ?? 0,
  );
  const trustedResalePrice = Number(
    exactMarket.trustedSuggestedPrice ?? scan.soldStats?.suggestedPrice ?? 0,
  );
  const acquisition = calculateDeliveredCost({
    askingPrice: parsed.listing.askingPrice,
    shipping: parsed.listing.shipping,
    tax: parsed.listing.tax,
    paymentFees: parsed.listing.buyerFees,
  });

  let resale = null;
  let offer = null;
  let outcome;

  if (!policy.accepted) {
    outcome = {
      label: "SUPPRESSED — IDENTITY/SCOPE RULE FAILED",
      purchaseReady: false,
      reason: policy.reasons.join(" "),
    };
  } else if (!(trustedResalePrice > 0) || pricingEligibleSoldCount < 1) {
    outcome = classifyProfitHunterOutcome({
      trustedResalePrice,
      pricingEligibleSoldCount,
      netProfit: 0,
      roiPercent: 0,
      manualReviewRequired: parsed.manualReviewRequired,
      sellerRisk: parsed.sellerRisk,
    });
  } else {
    resale = calculateResaleOutcome({
      deliveredCost: acquisition.deliveredCost,
      resalePrice: trustedResalePrice,
      sellingFeeRate: parsed.sellingFeeRate,
      orderFee: parsed.orderFee,
      paymentProcessingFees: parsed.paymentProcessingFees,
      outboundShipping: parsed.outboundShipping,
      supplies: parsed.supplies,
      gradingAuthentication: parsed.gradingAuthentication,
      cleaningPreparation: parsed.cleaningPreparation,
      labor: parsed.labor,
      returnReserveRate: parsed.returnReserveRate,
    });
    offer = calculateMaximumOffer({
      resalePrice: trustedResalePrice,
      sellingFeeRate: parsed.sellingFeeRate,
      orderFee: parsed.orderFee,
      paymentProcessingFees: parsed.paymentProcessingFees,
      outboundShipping: parsed.outboundShipping,
      supplies: parsed.supplies,
      gradingAuthentication: parsed.gradingAuthentication,
      cleaningPreparation: parsed.cleaningPreparation,
      labor: parsed.labor,
      returnReserveRate: parsed.returnReserveRate,
      shipping: parsed.listing.shipping,
      paymentFees: parsed.listing.buyerFees,
      targetRoi: 0.2,
    });
    outcome = classifyProfitHunterOutcome({
      trustedResalePrice,
      pricingEligibleSoldCount,
      netProfit: resale.netProfit,
      roiPercent: resale.roiPercent,
      manualReviewRequired: parsed.manualReviewRequired,
      sellerRisk: parsed.sellerRisk,
    });
  }

  return {
    listing: parsed.listing,
    ownedPurchaseExclusion: owned,
    identity: scan.ai || null,
    identityPolicy: policy,
    exactMarket: {
      status: exactMarket.status || null,
      pricingEligibleSoldCount,
      activeCount: Number(exactMarket.activeCount || 0),
      trustedResalePrice: trustedResalePrice || null,
      sold: (scan.soldComps || exactMarket.sold || []).slice(0, 25),
      active: (scan.activeComps || exactMarket.active || []).slice(0, 25),
    },
    acquisition,
    resale,
    offer,
    outcome,
    diagnostics: scan.pipelineDiagnostics || null,
  };
}
