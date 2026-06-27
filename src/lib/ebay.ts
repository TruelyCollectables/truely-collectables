import { createClient } from "@supabase/supabase-js";

const EBAY_API = "https://api.ebay.com";

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
}

function ebayReadHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Accept-Language": "en-US",
  };
}

function ebayWriteHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Content-Language": "en-US",
  };
}

async function getLatestRefreshToken() {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("ebay_tokens")
    .select("refresh_token")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data?.refresh_token) {
    throw new Error("No eBay refresh token found");
  }

  return data.refresh_token;
}

export async function getEbayAccessToken() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing eBay client credentials");
  }

  const refreshToken = await getLatestRefreshToken();

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );

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
    throw new Error(`eBay token refresh failed: ${JSON.stringify(data)}`);
  }

  return data.access_token as string;
}

export async function syncEbayQuantityAfterSale(params: {
  sku?: string | null;
  ebayItemId?: string | null;
  newQuantity: number;
}) {
  const { sku, ebayItemId, newQuantity } = params;

  if (!sku && !ebayItemId) {
    return {
      success: false,
      skipped: true,
      reason: "Missing sku and ebayItemId",
    };
  }

  const accessToken = await getEbayAccessToken();

  let finalSku = sku || null;

  if (!finalSku && ebayItemId) {
    const offerRes = await fetch(
      `${EBAY_API}/sell/inventory/v1/offer?limit=200`,
      { headers: ebayReadHeaders(accessToken) }
    );

    const offerData = await offerRes.json();

    if (!offerRes.ok) {
      throw new Error(`Could not list eBay offers: ${JSON.stringify(offerData)}`);
    }

    const matchingOffer = offerData.offers?.find(
      (offer: any) => String(offer?.listing?.listingId) === String(ebayItemId)
    );

    finalSku = matchingOffer?.sku || null;
  }

  if (!finalSku) {
    return {
      success: false,
      skipped: true,
      reason: "Could not determine SKU for eBay update",
    };
  }

  const inventoryRes = await fetch(
    `${EBAY_API}/sell/inventory/v1/inventory_item/${encodeURIComponent(
      finalSku
    )}`,
    { headers: ebayReadHeaders(accessToken) }
  );

  const inventoryItem = await inventoryRes.json();

  if (!inventoryRes.ok) {
    throw new Error(
      `Could not read eBay inventory item: ${JSON.stringify(inventoryItem)}`
    );
  }

  const updatedInventoryItem = {
    ...inventoryItem,
    availability: {
      ...(inventoryItem.availability || {}),
      shipToLocationAvailability: {
        ...(inventoryItem.availability?.shipToLocationAvailability || {}),
        quantity: Math.max(0, newQuantity),
      },
    },
  };

  const updateRes = await fetch(
    `${EBAY_API}/sell/inventory/v1/inventory_item/${encodeURIComponent(
      finalSku
    )}`,
    {
      method: "PUT",
      headers: ebayWriteHeaders(accessToken),
      body: JSON.stringify(updatedInventoryItem),
    }
  );

  if (!updateRes.ok) {
    const updateData = await updateRes.json().catch(() => ({}));
    throw new Error(
      `Could not update eBay quantity: ${JSON.stringify(updateData)}`
    );
  }

  return {
    success: true,
    sku: finalSku,
    ebayItemId,
    newQuantity: Math.max(0, newQuantity),
  };
}