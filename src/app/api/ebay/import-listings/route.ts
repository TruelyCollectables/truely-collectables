import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { inventoryEngine } from "../../../../modules/inventory";
import { getActiveStoreId } from "../../../../lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EBAY_API = "https://api.ebay.com";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
}

function ebayHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Accept-Language": "en-US",
  };
}

async function getAccessToken(refreshToken: string) {
  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    throw new Error("Missing eBay client credentials");
  }

  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(`${EBAY_API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "https://api.ebay.com/oauth/api_scope/sell.inventory",
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`eBay token error: ${JSON.stringify(data)}`);
  }

  return data.access_token;
}

function first(value: any) {
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

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const url = new URL(request.url);

    const offset = Number(url.searchParams.get("offset") || "0");
    const requestedLimit = Number(url.searchParams.get("limit") || DEFAULT_LIMIT);
    const limit = Math.min(Math.max(requestedLimit, 1), MAX_LIMIT);
    const runId = url.searchParams.get("runId") || new Date().toISOString();

    const debugSamples: any[] = [];

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

    const accessToken = await getAccessToken(tokenRow.refresh_token);

    const inventoryRes = await fetch(
      `${EBAY_API}/sell/inventory/v1/inventory_item?limit=${limit}&offset=${offset}`,
      { headers: ebayHeaders(accessToken) }
    );

    const inventoryData = await inventoryRes.json();

    if (!inventoryRes.ok) {
      throw new Error(`Inventory fetch failed: ${JSON.stringify(inventoryData)}`);
    }

    const items = inventoryData.inventoryItems || [];

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
        `${EBAY_API}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`,
        { headers: ebayHeaders(accessToken) }
      );

      const offerData = await offerRes.json();

      if (!offerRes.ok) {
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
        skipped++;
        debugSamples.push({
          reason: "no_offer_returned",
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
        last_seen_at: new Date().toISOString(),
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
          player: productData.player,
          sport: productData.sport,
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

    return NextResponse.json({
      success: true,
      imported,
      markedSold,
      skipped,
      offset,
      limit,
      received: items.length,
      nextOffset,
      runId,
      debugSamples: debugSamples.slice(0, 10),
      nextUrl:
        nextOffset === null
          ? null
          : `/api/ebay/import-listings?offset=${nextOffset}&limit=${limit}&runId=${encodeURIComponent(runId)}`,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
