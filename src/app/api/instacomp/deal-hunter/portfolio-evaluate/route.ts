import { NextRequest, NextResponse } from "next/server";
import { POST as runDealHunterCore } from "../evaluate/core";
import {
  persistExactCardMarketHistory,
  type ExactMarketTargetListing,
  type InstaCompRegistryTruth,
} from "../../../../../lib/instacomp-market-history";
import type { InstaCompAiResult, InstaCompComp } from "../../../../../lib/instacomp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

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

type PortfolioMultipart = {
  listingJson: string;
  listing: Record<string, any>;
  front: File;
  back: File;
};

async function readMultipart(request: Request): Promise<PortfolioMultipart> {
  const form = await request.formData();
  const listingJson = form.get("listingJson");
  const front = form.get("frontImage");
  const back = form.get("backImage");
  if (typeof listingJson !== "string") throw new Error("listingJson is required.");
  if (!(front instanceof File) || !(back instanceof File)) {
    throw new Error("Both frontImage and backImage are required.");
  }
  if (!ALLOWED_IMAGE_TYPES.has(front.type) || !ALLOWED_IMAGE_TYPES.has(back.type)) {
    throw new Error("Deal Hunter images must be JPEG, PNG, or WebP.");
  }
  if (
    front.size <= 0 ||
    back.size <= 0 ||
    front.size > MAX_IMAGE_BYTES ||
    back.size > MAX_IMAGE_BYTES
  ) {
    throw new Error("Deal Hunter images must be non-empty and no larger than 12MB each.");
  }
  return {
    listingJson,
    listing: JSON.parse(listingJson) as Record<string, any>,
    front,
    back,
  };
}

function coreRequest(source: Request, input: PortfolioMultipart) {
  const form = new FormData();
  form.set("listingJson", input.listingJson);
  form.set("frontImage", input.front, input.front.name || "front.jpg");
  form.set("backImage", input.back, input.back.name || "back.jpg");
  const headers = new Headers(source.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  return new NextRequest(source.url, {
    method: "POST",
    headers,
    body: form,
  });
}

export async function POST(request: NextRequest) {
  let input: PortfolioMultipart;
  try {
    input = await readMultipart(request);
  } catch (error) {
    return json(
      {
        ok: false,
        stage: "portfolio_input",
        error: error instanceof Error ? error.message : String(error),
      },
      400,
    );
  }

  let coreResponse: Response;
  try {
    coreResponse = await runDealHunterCore(coreRequest(request, input));
  } catch (error) {
    return json(
      {
        ok: false,
        stage: "portfolio_core_exception",
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }

  const payload = (await coreResponse.clone().json().catch(() => null)) as
    | Record<string, any>
    | null;
  if (!coreResponse.ok || payload?.ok !== true || !payload.scan) {
    if (payload) {
      return json(
        {
          ...payload,
          stage: payload.stage || "portfolio_core_response",
        },
        coreResponse.status || 500,
      );
    }
    return json(
      {
        ok: false,
        stage: "portfolio_core_non_json",
        error: `Hardened Deal Hunter core failed with HTTP ${coreResponse.status}.`,
      },
      coreResponse.status || 500,
    );
  }

  try {
    const scan = payload.scan as Record<string, any>;
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

    const listing = input.listing;
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

    return json({
      ...payload,
      marketHistory,
      portfolioEvaluator: {
        cloneFreeMultipart: true,
        registryExactLockRequired: true,
        exactSoldRequiredForPositiveEconomics: true,
      },
    });
  } catch (error) {
    return json(
      {
        ok: false,
        stage: "portfolio_exact_card_market_history",
        error: error instanceof Error ? error.message : String(error),
        originalEvaluation: payload.evaluation || null,
      },
      500,
    );
  }
}
