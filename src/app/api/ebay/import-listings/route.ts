import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const EBAY_API = "https://api.ebay.com";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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

  if (!res.ok) throw new Error(JSON.stringify(data));

  return data.access_token;
}

function first(value: any) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    const offset = Number(url.searchParams.get("offset") || "0");
    const requestedLimit = Number(url.searchParams.get("limit") || DEFAULT_LIMIT);
    const limit = Math.min(Math.max(requestedLimit, 1), MAX_LIMIT);

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
      {
        headers: ebayHeaders(accessToken),
      }
    );

    const inventoryData = await inventoryRes.json();

    if (!inventoryRes.ok) {
      throw new Error(JSON.stringify(inventoryData));
    }

    const items = inventoryData.inventoryItems || [];

    let imported = 0;
    let skipped = 0;

    for (const item of items) {
      const sku = item.sku;

      if (!sku) {
        skipped++;
        continue;
      }

      const offerRes = await fetch(
        `${EBAY_API}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`,
        {
          headers: ebayHeaders(accessToken),
        }
      );

      const offerData = await offerRes.json();

      if (!offerRes.ok) {
        console.error("Offer error for SKU:", sku, offerData);
        skipped++;
        continue;
      }

      const offer = offerData.offers?.[0];

      if (!offer?.listing?.listingId) {
        skipped++;
        continue;
      }

      const product = item.product || {};
      const aspects = product.aspects || {};

      const quantity =
        item.availability?.shipToLocationAvailability?.quantity ?? 0;

      const price = offer.pricingSummary?.price?.value
        ? Number(offer.pricingSummary.price.value)
        : 0;

      const player =
        first(aspects.Player) ||
        first(aspects.Athlete) ||
        first(aspects["Player/Athlete"]);

      const sport = first(aspects.Sport);

      const { error: upsertError } = await supabase.from("products").upsert(
        {
          title: product.title || "Untitled",
          description: product.description || "",
          price,
          player,
          sport,
          quantity,
          image_url: product.imageUrls?.[0] || null,
          ebay_item_id: offer.listing.listingId,
        },
        {
          onConflict: "ebay_item_id",
        }
      );

      if (upsertError) {
        console.error("Supabase upsert error:", upsertError);
        skipped++;
        continue;
      }

      imported++;
    }

    const nextOffset = items.length < limit ? null : offset + limit;

    return NextResponse.json({
      success: true,
      imported,
      skipped,
      offset,
      limit,
      received: items.length,
      nextOffset,
      nextUrl:
        nextOffset === null
          ? null
          : `/api/ebay/import-listings?offset=${nextOffset}&limit=${limit}`,
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