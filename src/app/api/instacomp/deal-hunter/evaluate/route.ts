import { NextRequest, NextResponse } from "next/server";
import { POST as runDealHunterCore } from "./multi-provider-core";
import { dealHunterListingRegistryConflict } from "../../../../../lib/deal-hunter-listing-registry-guard";
import {
  persistExactCardMarketHistory,
  type ExactMarketTargetListing,
  type InstaCompRegistryTruth,
} from "../../../../../lib/instacomp-market-history";
import type { InstaCompAiResult, InstaCompComp } from "../../../../../lib/instacomp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : null;
}

function deliveredCost(listing: Record<string, unknown>) {
  const parts = [
    numberValue(listing.itemPrice),
    numberValue(listing.inboundShipping),
    numberValue(listing.buyerFees),
    numberValue(listing.tax),
  ];
  return Number(parts.reduce<number>((sum, value) => sum + (value || 0), 0).toFixed(2));
}

async function listingFromClone(request: Request) {
  const form = await request.formData();
  const raw = form.get("listingJson");
  if (typeof raw !== "string") return null;
  return JSON.parse(raw) as Record<string, unknown>;
}

function listingConflictResponse(
  payload: Record<string, any>,
  scan: Record<string, any>,
  reason: string,
) {
  const originalAi = (scan.ai || {}) as Record<string, any>;
  const originalRegistry = (scan.checklistRegistry || {}) as Record<string, any>;
  const originalExactMarket = (scan.exactMarket || {}) as Record<string, any>;
  const rejectedIdentityId =
    originalAi.internalChecklistIdentityId || originalRegistry.identityId || null;
  const rejectedFingerprint =
    originalAi.internalChecklistFingerprintSha256 ||
    originalRegistry.fingerprintSha256 ||
    null;

  const ai = {
    ...originalAi,
    internalRejectedRegistryIdentityId: rejectedIdentityId,
    internalRejectedRegistryFingerprintSha256: rejectedFingerprint,
    internalChecklistIdentityId: null,
    internalChecklistFingerprintSha256: null,
    internalChecklistOutcome: "listing_identity_conflict",
    internalChecklistReasons: [
      ...(Array.isArray(originalAi.internalChecklistReasons)
        ? originalAi.internalChecklistReasons
        : []),
      `deal_hunter_listing_identity_conflict:${reason}`,
    ],
  };

  const safeScan = {
    ...scan,
    ai,
    checklistRegistry: {
      ...originalRegistry,
      matched: false,
      identityConfirmed: false,
      identityId: null,
      fingerprintSha256: null,
      status: "listing_identity_conflict",
      reasons: [
        ...(Array.isArray(originalRegistry.reasons) ? originalRegistry.reasons : []),
        reason,
      ],
    },
    exactMarket: {
      ...originalExactMarket,
      status: "identity_incomplete",
      rejectedQuery: originalExactMarket.query || null,
      query: null,
      queries: [],
      sold: [],
      active: [],
      soldCount: 0,
      activeCount: 0,
      pricingEligibleSoldCount: 0,
      pricingEligibleActiveCount: 0,
      trustedSuggestedPrice: null,
    },
    soldComps: [],
    activeComps: [],
  };

  return NextResponse.json(
    {
      ...payload,
      evaluation: {
        ...(payload.evaluation || {}),
        status: "identity_review",
        soldCount: 0,
        conservativeResale: null,
        expectedNetProfit: null,
        roiPercent: null,
        dealLabel: "SUPPRESSED — LISTING / REGISTRY IDENTITY CONFLICT",
        actionable: false,
        alertworthy: false,
        reason,
        errorCode: "DEAL_HUNTER_LISTING_IDENTITY_CONFLICT",
      },
      scan: safeScan,
      marketHistory: {
        status: "skipped",
        reason: "listing_registry_identity_conflict",
      },
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

export async function POST(request: NextRequest) {
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    return runDealHunterCore(request);
  }

  const requestCopy = request.clone();
  const coreResponse = await runDealHunterCore(request);
  if (!coreResponse.ok) return coreResponse;

  const payload = (await coreResponse.clone().json()) as Record<string, any>;
  if (payload.ok !== true || !payload.scan) return coreResponse;

  try {
    const listing = await listingFromClone(requestCopy);
    if (!listing) throw new Error("Deal Hunter history wrapper could not recover listingJson.");

    const scan = payload.scan as Record<string, any>;
    const conflict = dealHunterListingRegistryConflict(listing, scan);
    if (conflict) {
      return listingConflictResponse(payload, scan, conflict);
    }

    const registry = (scan.checklistRegistry || null) as InstaCompRegistryTruth | null;
    const ai = (scan.ai || {}) as InstaCompAiResult;
    const exactMarket = (scan.exactMarket || {}) as Record<string, any>;
    const sold = (
      Array.isArray(scan.soldComps)
        ? scan.soldComps
        : Array.isArray(exactMarket.sold)
          ? exactMarket.sold
          : []
    ) as InstaCompComp[];
    const active = (
      Array.isArray(scan.activeComps)
        ? scan.activeComps
        : Array.isArray(exactMarket.active)
          ? exactMarket.active
          : []
    ) as InstaCompComp[];

    const targetListing: ExactMarketTargetListing = {
      title: String(listing.title || "Untitled Deal Hunter listing"),
      marketplace: String(listing.marketplace || "eBay"),
      listingUrl: String(listing.listingUrl || ""),
      listingItemId: String(listing.listingItemId || "").trim() || null,
      itemPrice: numberValue(listing.itemPrice),
      shippingPrice: numberValue(listing.inboundShipping),
      buyerFees: numberValue(listing.buyerFees),
      tax: numberValue(listing.tax),
      deliveredPrice: deliveredCost(listing),
      currency: "USD",
      conditionText: String(listing.conditionText || "").trim() || null,
      observedAt: new Date().toISOString(),
    };

    const marketHistory = await persistExactCardMarketHistory({
      registry,
      ai,
      sold,
      active,
      targetListing,
      scanId: String(scan.scanId || scan.scan_id || "").trim() || null,
      observedAt: targetListing.observedAt || undefined,
    });

    if (registry?.matched === true && marketHistory.status !== "saved") {
      throw new Error(
        `Registry-confirmed Deal Hunter card was not persisted to market history: ${marketHistory.reason}`,
      );
    }

    return NextResponse.json(
      { ...payload, marketHistory },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        stage: "exact_card_market_history",
        originalEvaluation: payload.evaluation || null,
      },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
