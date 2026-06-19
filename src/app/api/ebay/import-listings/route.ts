import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET() {
  const { data: tokens } = await supabase
    .from("ebay_tokens")
    .select("*")
    .order("id", { ascending: false })
    .limit(1);

  const refreshToken = tokens?.[0]?.refresh_token;

  if (!refreshToken) {
    return NextResponse.json({ error: "No eBay refresh token found" });
  }

  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString("base64");

  const tokenResponse = await fetch(
    "https://api.ebay.com/identity/v1/oauth2/token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope:
          "https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.account.readonly",
      }),
    }
  );

  const tokenData = await tokenResponse.json();

  if (!tokenData.access_token) {
    return NextResponse.json(tokenData);
  }

  const inventoryResponse = await fetch(
    "https://api.ebay.com/sell/inventory/v1/inventory_item?limit=25",
    {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Accept-Language": "en-US",
        "Content-Type": "application/json",
      },
    }
  );

  const inventoryData = await inventoryResponse.json();

  const offersResponse = await fetch(
    "https://api.ebay.com/sell/inventory/v1/offer?limit=200",
    {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Accept-Language": "en-US",
        "Content-Type": "application/json",
      },
    }
  );

  const offersData = await offersResponse.json();

  const offersBySku = new Map();

  for (const offer of offersData.offers || []) {
    offersBySku.set(offer.sku, offer);
  }

  const products =
    inventoryData.inventoryItems?.map((item: any) => {
      const offer = offersBySku.get(item.sku);

      return {
        ebay_item_id: item.sku,
        title: item.product?.title || "Untitled eBay Item",
        description: item.product?.description || "",
        image_url: item.product?.imageUrls?.[0] || "",
        quantity:
          item.availability?.shipToLocationAvailability?.quantity || 0,
        sport: item.product?.aspects?.Sport?.[0] || "",
        player: item.product?.aspects?.["Player/Athlete"]?.[0] || "",
        price: offer?.pricingSummary?.price?.value
          ? Number(offer.pricingSummary.price.value)
          : 0,
      };
    }) || [];

  const { error } = await supabase.from("products").upsert(products, {
    onConflict: "ebay_item_id",
  });

  if (error) {
    return NextResponse.json({ error });
  }

  return NextResponse.json({
    success: true,
    imported: products.length,
  });
}