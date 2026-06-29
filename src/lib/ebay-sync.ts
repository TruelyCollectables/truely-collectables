import { createClient } from "@supabase/supabase-js";
import { inventoryEngine } from "../modules/inventory";
import { mapEbayInventoryCategory } from "./ebay-category-mapper";
import { getActiveStoreId } from "./stores";
import { getStoreSettings } from "./store-settings";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type EbayDebugSample = {
  reason: string;
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

export type EbayImportPageResult = {
  success: true;
  imported: number;
  markedSold: number;
  skipped: number;
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

  for (const item of items) {
    const sku = item.sku;

    if (!sku) {
      skipped++;
      debugSamples.push({
        reason: "missing_sku",
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
        await inventoryEngine.markEbayListingInactive({
          sku,
          ebayItemId: null,
        });

        markedSold++;
        debugSamples.push({
          reason: "offer_unavailable",
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
      await inventoryEngine.markEbayListingInactive({
        sku,
        ebayItemId: null,
      });

      markedSold++;
      debugSamples.push({
        reason: "no_active_offer_returned",
        sku,
        offerData,
      });
      continue;
    }

    if (!isActiveOffer(offer)) {
      await inventoryEngine.markEbayListingInactive({
        sku,
        ebayItemId: listingId,
      });

      markedSold++;
      debugSamples.push({
        reason: "offer_not_active",
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
        reviewRequired: categoryMapping.reviewRequired,
        attributes: categoryMapping.attributes,
      });
    } catch (upsertError) {
      skipped++;
      debugSamples.push({
        reason: "upsert_failed",
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
