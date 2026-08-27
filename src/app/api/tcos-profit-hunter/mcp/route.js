import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  calculateDeliveredCost,
  calculateMaximumOffer,
  calculateResaleOutcome,
} from "../../../../../connectors/tcos-market-intel-mcp/src/logic.mjs";
import {
  classifyProfitHunterOutcome,
  hardenedInstaCompService,
} from "../../../../../connectors/tcos-market-intel-mcp/src/instacomp-bridge.mjs";
import { publicSearchService } from "../../../../../connectors/tcos-market-intel-mcp/src/public-search.mjs";
import { checkProfitHunterOwnedPurchase } from "../../../../lib/tcos-profit-hunter-owned";
import {
  profitHunterLockedScope,
  TCOS_WNBA_ROOKIE_PLAYERS,
  validateProfitHunterIdentity,
  validateProfitHunterServiceBearer,
} from "../../../../lib/tcos-profit-hunter-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const laneSchema = z.enum([
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

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function lockedSearchRequest({ lane, player, query, maxResults }) {
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

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "profit_hunter_status",
      {
        title: "Profit Hunter Status",
        description:
          "Return the locked Deal Hunter scope and whether public discovery and hardened InstaComp are configured.",
        inputSchema: {},
      },
      async () =>
        toolResult({
          ok: true,
          service: "TCOS Deal Hunter / Profit Hunter",
          version: "1.0.0",
          scope: profitHunterLockedScope(),
          discovery: publicSearchService.status(),
          hardenedInstaComp: hardenedInstaCompService.status(),
          purchaseWritesEnabled: false,
        }),
    );

    server.registerTool(
      "search_profit_hunter_candidates",
      {
        title: "Search Profit Hunter Candidates",
        description:
          "Search public marketplaces using the locked TCOS lane rules. Results are discovery candidates only and are never purchase-ready until hardened verification passes.",
        inputSchema: {
          lane: laneSchema,
          player: z.string().nullable().optional(),
          query: z.string().nullable().optional(),
          maxResults: z.number().int().min(1).max(50).default(20),
        },
      },
      async ({ lane, player, query, maxResults }) => {
        const request = lockedSearchRequest({
          lane,
          player: player || null,
          query: query || null,
          maxResults,
        });
        const discovery = await publicSearchService.search({
          ...request,
          maxResults,
          exactIdentityOnly: false,
        });
        const candidates = discovery.results.map((candidate) => ({
          ...candidate,
          purchaseReady: false,
          requiresHardenedVerification: true,
          frontBackSelectionRequired: (candidate.imageUrls || []).length < 2,
        }));
        return toolResult({
          lane,
          count: candidates.length,
          candidates,
          sourceReports: discovery.sourceReports,
          warnings: discovery.warnings,
        });
      },
    );

    server.registerTool(
      "verify_profit_hunter_listing",
      {
        title: "Verify Profit Hunter Listing",
        description:
          "Run the exact listing front/back images through hardened InstaComp, enforce the locked lane policy, exclude owned purchases, and calculate fail-closed 20%+ net ROI economics.",
        inputSchema: {
          lane: laneSchema,
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
        },
      },
      async (input) => {
        if (input.lane === "signed_baseball") {
          return toolResult({
            listing: input.listing,
            outcome: {
              label: "SUPPRESSED — MEMORABILIA REVIEW REQUIRED",
              purchaseReady: false,
              reason:
                "Signed baseballs use a separate authentication/provenance workflow and are not certified by the card scanner.",
            },
          });
        }

        const owned = await checkProfitHunterOwnedPurchase(input.listing.url);
        if (owned.owned) {
          return toolResult({
            listing: input.listing,
            ownedPurchaseExclusion: owned,
            outcome: {
              label: "SUPPRESSED — OWNED PURCHASE",
              purchaseReady: false,
              reason: owned.reason,
            },
          });
        }

        const scan = await hardenedInstaCompService.scanListing({
          frontImageUrl: input.listing.frontImageUrl,
          backImageUrl: input.listing.backImageUrl,
          aiCouncilTier: input.aiCouncilTier,
          operatorSerialNumberOverride: input.operatorSerialNumberOverride,
        });
        const policy = validateProfitHunterIdentity({
          lane: input.lane,
          expectedPlayer: input.expectedPlayer || null,
          identity: scan.ai || {},
          trueFirstBowmanEvidence: input.trueFirstBowmanEvidence || null,
        });

        const exactMarket = scan.exactMarket || {};
        const pricingEligibleSoldCount = Number(
          exactMarket.pricingEligibleSoldCount ?? scan.soldComps?.length ?? 0,
        );
        const trustedResalePrice = Number(
          exactMarket.trustedSuggestedPrice ?? scan.soldStats?.suggestedPrice ?? 0,
        );
        const acquisition = calculateDeliveredCost({
          askingPrice: input.listing.askingPrice,
          shipping: input.listing.shipping,
          tax: input.listing.tax,
          paymentFees: input.listing.buyerFees,
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
            manualReviewRequired: input.manualReviewRequired,
            sellerRisk: input.sellerRisk,
          });
        } else {
          resale = calculateResaleOutcome({
            deliveredCost: acquisition.deliveredCost,
            resalePrice: trustedResalePrice,
            sellingFeeRate: input.sellingFeeRate,
            orderFee: input.orderFee,
            paymentProcessingFees: input.paymentProcessingFees,
            outboundShipping: input.outboundShipping,
            supplies: input.supplies,
            gradingAuthentication: input.gradingAuthentication,
            cleaningPreparation: input.cleaningPreparation,
            labor: input.labor,
            returnReserveRate: input.returnReserveRate,
          });
          offer = calculateMaximumOffer({
            resalePrice: trustedResalePrice,
            sellingFeeRate: input.sellingFeeRate,
            orderFee: input.orderFee,
            paymentProcessingFees: input.paymentProcessingFees,
            outboundShipping: input.outboundShipping,
            supplies: input.supplies,
            gradingAuthentication: input.gradingAuthentication,
            cleaningPreparation: input.cleaningPreparation,
            labor: input.labor,
            returnReserveRate: input.returnReserveRate,
            shipping: input.listing.shipping,
            paymentFees: input.listing.buyerFees,
            targetRoi: 0.2,
          });
          outcome = classifyProfitHunterOutcome({
            trustedResalePrice,
            pricingEligibleSoldCount,
            netProfit: resale.netProfit,
            roiPercent: resale.roiPercent,
            manualReviewRequired: input.manualReviewRequired,
            sellerRisk: input.sellerRisk,
          });
        }

        return toolResult({
          listing: input.listing,
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
        });
      },
    );
  },
  {},
  {
    basePath: "/api/tcos-profit-hunter",
    maxDuration: 300,
    verboseLogs: false,
  },
);

async function authorized(request) {
  if (
    !validateProfitHunterServiceBearer(request.headers.get("authorization"))
  ) {
    return Response.json(
      { error: "Unauthorized", code: "TCOS_PROFIT_HUNTER_UNAUTHORIZED" },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "WWW-Authenticate": "Bearer",
        },
      },
    );
  }
  return handler(request);
}

export { authorized as GET, authorized as POST, authorized as DELETE };
