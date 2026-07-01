import { createClient } from "@supabase/supabase-js";
import { inventoryEngine } from "../modules/inventory";
import { mapEbayInventoryCategory } from "./ebay-category-mapper";
import { getActiveStoreId } from "./stores";
import { getStoreSettings } from "./store-settings";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type EbayDebugSample = {
  reason: string;
  policyDecision?: EbaySyncPolicyDecisionName;
  sku?: string;
  listingId?: string | null;
  status?: number;
  offerStatus?: string | null;
  listingStatus?: string | null;
  item?: unknown;
  offerData?: unknown;
  upsertError?: unknown;
  productData?: unknown;
};

type EbaySyncPolicyDecisionName =
  | "allowed"
  | "needs_review"
  | "blocked_by_tcos_policy";

type EbaySyncPolicyAction = "import_listing" | "mark_inactive" | "skip";

type EbaySyncPolicyDecision = {
  decision: EbaySyncPolicyDecisionName;
  action: EbaySyncPolicyAction;
  reason: string;
  reviewRequired: boolean;
};

export type EbayImportPageResult = {
  success: true;
  imported: number;
  markedSold: number;
  skipped: number;
  policyAllowed: number;
  policyNeedsReview: number;
  policyBlocked: number;
  offset: number;
  limit: number;
  received: number;
  nextOffset: number | null;
  runId: string;
  storeId: string;
  ebayEnvironment: string;
  debugSamples: EbayDebugSample[];
  nextUrl: string | null;
};

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
}

function ebayApiBase(environment: string) {
  return environment === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
}

function ebayHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Accept-Language": "en-US",
  };
}

async function getAccessToken(params: {
  refreshToken: string;
  ebayApi: string;
}) {
  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    throw new Error("Missing eBay client credentials");
  }

  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`,
  ).toString("base64");

  const res = await fetch(`${params.ebayApi}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
      scope: "https://api.ebay.com/oauth/api_scope/sell.inventory",
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`eBay token error: ${JSON.stringify(data)}`);
  }

  return data.access_token as string;
}

function first(value: unknown) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function getPrice(offer: any) {
  const value = offer?.pricingSummary?.price?.value;
  const num = Number(value);
  return !Number.isNaN(num) && num > 0 ? num : 0;
}

function isActiveOffer(offer: any) {
  return (
    offer?.status === "PUBLISHED" &&
    offer?.listing?.listingStatus === "ACTIVE"
  );
}

function isUnavailableOfferResponse(status: number, data: unknown) {
  if (status === 404) return true;

  const serialized = JSON.stringify(data).toLowerCase();

  return (
    serialized.includes("offer is not available") ||
    serialized.includes("offer not available")
  );
}

function clampLimit(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(Math.max(value, 1), MAX_LIMIT);
}

function isMissingDecisionTable(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("ebay_sync_decision_events")
  );
}

function policyGuard(params: {
  action: EbaySyncPolicyAction;
  sku?: string | null;
  listingId?: string | null;
  title?: string | null;
  price?: number | null;
  quantity?: number | null;
  categoryConfidence?: string | null;
  reviewRequired?: boolean;
  reason?: string;
}): EbaySyncPolicyDecision {
  if (!params.sku) {
    return {
      decision: "blocked_by_tcos_policy",
      action: "skip",
      reason: "missing_sku",
      reviewRequired: true,
    };
  }

  if (params.action === "mark_inactive") {
    return {
      decision: "allowed",
      action: "mark_inactive",
      reason: params.reason || "ebay_listing_inactive",
      reviewRequired: false,
    };
  }

  if (params.action !== "import_listing") {
    return {
      decision: "allowed",
      action: params.action,
      reason: params.reason || "allowed_skip",
      reviewRequired: false,
    };
  }

  if (!params.listingId) {
    return {
      decision: "blocked_by_tcos_policy",
      action: "skip",
      reason: "missing_ebay_listing_id",
      reviewRequired: true,
    };
  }

  if (!Number.isFinite(Number(params.price)) || Number(params.price) <= 0) {
    return {
      decision: "blocked_by_tcos_policy",
      action: "skip",
      reason: "invalid_listing_price",
      reviewRequired: true,
    };
  }

  if (!Number.isFinite(Number(params.quantity)) || Number(params.quantity) < 0) {
    return {
      decision: "blocked_by_tcos_policy",
      action: "skip",
      reason: "invalid_listing_quantity",
      reviewRequired: true,
    };
  }

  if (!params.title || params.title.trim().toLowerCase() === "untitled") {
    return {
      decision: "needs_review",
      action: "import_listing",
      reason: "missing_product_title",
      reviewRequired: true,
    };
  }

  if (params.reviewRequired) {
    return {
      decision: "needs_review",
      action: "import_listing",
      reason: "category_review_required",
      reviewRequired: true,
    };
  }

  if (params.categoryConfidence === "low") {
    return {
      decision: "needs_review",
      action: "import_listing",
      reason: "low_category_confidence",
      reviewRequired: true,
    };
  }

  return {
    decision: "allowed",
    action: "import_listing",
    reason: "active_listing_passed_policy",
    reviewRequired: false,
  };
}

async function recordPolicyDecision(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  storeId: string;
  runId: string;
  source?: string;
  decision: EbaySyncPolicyDecision;
  sku?: string | null;
  ebayItemId?: string | null;
  productTitle?: string | null;
  quantity?: number | null;
  price?: number | null;
  category?: string | null;
  categoryConfidence?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await params.supabase
    .from("ebay_sync_decision_events")
    .insert({
      store_id: params.storeId,
      run_id: params.runId,
      source: params.source || "ebay_inventory_import",
      action: params.decision.action,
      decision: params.decision.decision,
      reason: params.decision.reason,
      sku: params.sku || null,
      ebay_item_id: params.ebayItemId || null,
      product_title: params.productTitle || null,
      quantity:
        params.quantity === null || params.quantity === undefined
          ? null
          : Math.max(0, Math.floor(Number(params.quantity))),
      price:
        params.price === null || params.price === undefined
          ? null
          : Number(params.price),
      category: params.category || null,
      category_confidence: params.categoryConfidence || null,
      review_required: params.decision.reviewRequired,
      policy_metadata: params.metadata || {},
    });

  if (error && !isMissingDecisionTable(error)) {
    console.error("eBay sync decision insert failed:", error.message);
  }
}

function incrementPolicyCount(
  counts: Record<EbaySyncPolicyDecisionName, number>,
  decision: EbaySyncPolicyDecisionName,
) {
  counts[decision] += 1;
}

export async function importEbayListingsPage(params: {
  offset?: number;
  limit?: number;
  runId?: string;
} = {}): Promise<EbayImportPageResult> {
  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();
  const storeSettings = await getStoreSettings(supabase, storeId);

  if (!storeSettings.ebaySyncEnabled) {
    throw new Error("eBay sync is disabled for this store");
  }

  const ebayApi = ebayApiBase(storeSettings.ebayEnvironment);
  const offset = Math.max(Number(params.offset ?? 0), 0);
  const limit = clampLimit(Number(params.limit ?? DEFAULT_LIMIT));
  const runId = params.runId || new Date().toISOString();

  const { data: tokenRow, error: tokenError } = await supabase
    .from("ebay_tokens")
    .select("refresh_token")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (tokenError || !tokenRow?.refresh_token) {
    throw new Error("No eBay refresh token found");
  }

  const accessToken = await getAccessToken({
    refreshToken: tokenRow.refresh_token,
    ebayApi,
  });

  const inventoryRes = await fetch(
    `${ebayApi}/sell/inventory/v1/inventory_item?limit=${limit}&offset=${offset}`,
    { headers: ebayHeaders(accessToken) },
  );

  const inventoryData = await inventoryRes.json();

  if (!inventoryRes.ok) {
    throw new Error(`Inventory fetch failed: ${JSON.stringify(inventoryData)}`);
  }

  const items = inventoryData.inventoryItems || [];
  const debugSamples: EbayDebugSample[] = [];
  let imported = 0;
  let markedSold = 0;
  let skipped = 0;
  const policyCounts: Record<EbaySyncPolicyDecisionName, number> = {
    allowed: 0,
    needs_review: 0,
    blocked_by_tcos_policy: 0,
  };

  for (const item of items) {
    const sku = item.sku;

    if (!sku) {
      const decision = policyGuard({
        action: "skip",
        sku,
        reason: "missing_sku",
      });

      incrementPolicyCount(policyCounts, decision.decision);
      await recordPolicyDecision({
        supabase,
        storeId,
        runId,
        decision,
        metadata: {
          item,
        },
      });

      skipped++;
      debugSamples.push({
        reason: decision.reason,
        policyDecision: decision.decision,
        item,
      });
      continue;
    }

    const offerRes = await fetch(
      `${ebayApi}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`,
      { headers: ebayHeaders(accessToken) },
    );

    const offerData = await offerRes.json();

    if (!offerRes.ok) {
      if (isUnavailableOfferResponse(offerRes.status, offerData)) {
        const decision = policyGuard({
          action: "mark_inactive",
          sku,
          reason: "offer_unavailable",
        });

        incrementPolicyCount(policyCounts, decision.decision);
        await recordPolicyDecision({
          supabase,
          storeId,
          runId,
          decision,
          sku,
          metadata: {
            status: offerRes.status,
            offerData,
          },
        });

        await inventoryEngine.markEbayListingInactive({
          sku,
          ebayItemId: null,
        });

        markedSold++;
        debugSamples.push({
          reason: decision.reason,
          policyDecision: decision.decision,
          sku,
          status: offerRes.status,
          offerData,
        });
        continue;
      }

      skipped++;
      debugSamples.push({
        reason: "offer_lookup_failed",
        sku,
        status: offerRes.status,
        offerData,
      });
      continue;
    }

    const offer = offerData.offers?.[0];
    const listingId = offer?.listing?.listingId || null;

    if (!offer) {
      const decision = policyGuard({
        action: "mark_inactive",
        sku,
        reason: "no_active_offer_returned",
      });

      incrementPolicyCount(policyCounts, decision.decision);
      await recordPolicyDecision({
        supabase,
        storeId,
        runId,
        decision,
        sku,
        metadata: {
          offerData,
        },
      });

      await inventoryEngine.markEbayListingInactive({
        sku,
        ebayItemId: null,
      });

      markedSold++;
      debugSamples.push({
        reason: decision.reason,
        policyDecision: decision.decision,
        sku,
        offerData,
      });
      continue;
    }

    if (!isActiveOffer(offer)) {
      const decision = policyGuard({
        action: "mark_inactive",
        sku,
        listingId,
        reason: "offer_not_active",
      });

      incrementPolicyCount(policyCounts, decision.decision);
      await recordPolicyDecision({
        supabase,
        storeId,
        runId,
        decision,
        sku,
        ebayItemId: listingId,
        metadata: {
          offerStatus: offer?.status,
          listingStatus: offer?.listing?.listingStatus,
        },
      });

      await inventoryEngine.markEbayListingInactive({
        sku,
        ebayItemId: listingId,
      });

      markedSold++;
      debugSamples.push({
        reason: decision.reason,
        policyDecision: decision.decision,
        sku,
        listingId,
        offerStatus: offer?.status,
        listingStatus: offer?.listing?.listingStatus,
      });
      continue;
    }

    const product = item.product || {};
    const aspects = product.aspects || {};
    const quantity =
      item.availability?.shipToLocationAvailability?.quantity ?? 0;
    const price = getPrice(offer);
    const player =
      first(aspects.Player) ||
      first(aspects.Athlete) ||
      first(aspects["Player/Athlete"]);
    const sport = first(aspects.Sport);
    const categoryMapping = mapEbayInventoryCategory({
      title: product.title || "Untitled",
      description: product.description || offer.listingDescription || "",
      aspects,
    });

    const productData = {
      sku,
      title: product.title || "Untitled",
      description: product.description || offer.listingDescription || "",
      price,
      player,
      sport,
      quantity,
      image_url: product.imageUrls?.[0] || null,
      ebay_item_id: listingId,
    };
    const decision = policyGuard({
      action: "import_listing",
      sku,
      listingId,
      title: productData.title,
      price: productData.price,
      quantity: productData.quantity,
      categoryConfidence: categoryMapping.confidence,
      reviewRequired: categoryMapping.reviewRequired,
    });

    incrementPolicyCount(policyCounts, decision.decision);
    await recordPolicyDecision({
      supabase,
      storeId,
      runId,
      decision,
      sku,
      ebayItemId: listingId,
      productTitle: productData.title,
      quantity: productData.quantity,
      price: productData.price,
      category: categoryMapping.category,
      categoryConfidence: categoryMapping.confidence,
      metadata: {
        offerStatus: offer?.status,
        listingStatus: offer?.listing?.listingStatus,
      },
    });

    if (decision.decision === "blocked_by_tcos_policy") {
      skipped++;
      debugSamples.push({
        reason: decision.reason,
        policyDecision: decision.decision,
        sku,
        listingId,
        productData,
      });
      continue;
    }

    try {
      await inventoryEngine.upsertFromEbayListing({
        sku: productData.sku,
        title: productData.title,
        description: productData.description,
        price: productData.price,
        quantity: productData.quantity,
        imageUrl: productData.image_url,
        ebayItemId: productData.ebay_item_id,
        player: productData.player as string | null,
        sport: productData.sport as string | null,
        category: categoryMapping.category,
        categoryConfidence: categoryMapping.confidence,
        reviewRequired:
          categoryMapping.reviewRequired || decision.decision === "needs_review",
        attributes: categoryMapping.attributes,
      });
    } catch (upsertError) {
      skipped++;
      debugSamples.push({
        reason: "upsert_failed",
        policyDecision: decision.decision,
        sku,
        listingId,
        upsertError,
        productData,
      });
      continue;
    }

    imported++;
  }

  const nextOffset = items.length < limit ? null : offset + limit;

  return {
    success: true,
    imported,
    markedSold,
    skipped,
    policyAllowed: policyCounts.allowed,
    policyNeedsReview: policyCounts.needs_review,
    policyBlocked: policyCounts.blocked_by_tcos_policy,
    offset,
    limit,
    received: items.length,
    nextOffset,
    runId,
    storeId,
    ebayEnvironment: storeSettings.ebayEnvironment,
    debugSamples: debugSamples.slice(0, 10),
    nextUrl:
      nextOffset === null
        ? null
        : `/api/ebay/import-listings?offset=${nextOffset}&limit=${limit}&runId=${encodeURIComponent(runId)}`,
  };
}
