import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-key"
);

const EBAY_API = "https://api.ebay.com";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function ebayHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Accept-Language": "en-US",
  };
}

async function getAccessToken(refreshToken: string) {
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
    const url = new URL(request.url);

    const offset = Number(url.searchParams.get("offset") || "0");
    const requestedLimit = Number(url.searchParams.get("limit") || DEFAULT_LIMIT);
    const limit = Math.min(Math.max(requestedLimit, 1), MAX_LIMIT);
    const runId = url.searchParams.get("runId") || new Date().toISOString();

    const debugSamples: any[] = [];

    const { data: tokenRow, error: tokenError } = await supabase
      .from("ebay_tokens")
      .select("refresh_token")
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
        await supabase.from("products").update({ quantity: 0 }).eq("sku", sku);

        if (listingId) {
          await supabase
            .from("products")
            .update({ quantity: 0 })
            .eq("ebay_item_id", listingId);
        }

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
        last_seen_at: runId,
      };

      if (listingId) {
        const { data: updatedRows, error: updateError } = await supabase
          .from("products")
          .update(productData)
          .eq("ebay_item_id", listingId)
          .select("id");

        if (updateError) {
          skipped++;
          debugSamples.push({
            reason: "update_by_ebay_item_id_failed",
            sku,
            listingId,
            updateError,
          });
          continue;
        }

        if (updatedRows && updatedRows.length > 0) {
          imported++;
          continue;
        }
      }

      const { error: upsertError } = await supabase.from("products").upsert(
        productData,
        {
          onConflict: "sku",
        }
      );

      if (upsertError) {
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