import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const EBAY_API = "https://api.ebay.com";
const PAGE_LIMIT = 200;

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
    throw new Error(JSON.stringify(data));
  }

  return data.access_token;
}

function getFirst(value: any) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

export async function GET() {
  try {
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

    let offset = 0;
    let imported = 0;
    let totalSeen = 0;
    let page = 1;

    while (true) {
      const inventoryUrl = `${EBAY_API}/sell/inventory/v1/inventory_item?limit=${PAGE_LIMIT}&offset=${offset}`;

      const inventoryRes = await fetch(inventoryUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        },
      });

      const inventoryData = await inventoryRes.json();

      if (!inventoryRes.ok) {
        throw new Error(JSON.stringify(inventoryData));
      }

      const items = inventoryData.inventoryItems || [];

      if (items.length === 0) {
        break;
      }

      totalSeen += items.length;

      for (const item of items) {
        const sku = item.sku;

        if (!sku) continue;

        const offerRes = await fetch(
          `${EBAY_API}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
            },
          }
        );

        const offerData = await offerRes.json();

        if (!offerRes.ok) {
          console.error("Offer error:", sku, offerData);
          continue;
        }

        const offer = offerData.offers?.[0];

        if (!offer?.listing?.listingId) {
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
          getFirst(aspects.Player) ||
          getFirst(aspects.Athlete) ||
          getFirst(aspects["Player/Athlete"]);

        const sport = getFirst(aspects.Sport);

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
          continue;
        }

        imported++;
      }

      console.log(`Finished page ${page}, items: ${items.length}`);

      if (items.length < PAGE_LIMIT) {
        break;
      }

      offset += PAGE_LIMIT;
      page++;
    }

    return NextResponse.json({
      success: true,
      imported,
      totalSeen,
      pages: page,
    });
  } catch (error: any) {
    console.error("Import failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}