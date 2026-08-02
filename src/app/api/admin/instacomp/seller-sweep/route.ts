import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const EBAY_API = "https://api.ebay.com";

function extractSeller(input: string) {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_.-]+$/.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid eBay seller name or store URL.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const strIndex = parts.findIndex((part) => part.toLowerCase() === "str");
  if (strIndex >= 0 && parts[strIndex + 1]) return parts[strIndex + 1];
  const seller = url.searchParams.get("_ssn");
  if (seller) return seller;
  throw new Error("Could not determine the seller from that eBay URL.");
}

async function getBrowseToken() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Missing eBay client credentials.");
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(`${EBAY_API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`eBay token failed: ${data.error_description || data.error || response.status}`);
  }
  return data.access_token as string;
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const seller = extractSeller(String(body?.sellerUrl || ""));
    const query = String(body?.query || "WNBA lot").trim() || "WNBA lot";
    const token = await getBrowseToken();
    const params = new URLSearchParams({
      q: query,
      limit: "200",
      filter: `sellers:{${seller}}`,
    });
    const response = await fetch(`${EBAY_API}/buy/browse/v1/item_summary/search?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.errors?.[0]?.message || `eBay Browse failed (${response.status}).`);
    }
    const listings = (data.itemSummaries || []).map((item: any) => ({
      itemId: String(item.itemId || ""),
      title: String(item.title || "Untitled listing"),
      itemWebUrl: String(item.itemWebUrl || item.itemAffiliateWebUrl || "#"),
      imageUrl: item.image?.imageUrl || null,
      price: numeric(item.price?.value),
      shipping: numeric(item.shippingOptions?.[0]?.shippingCost?.value),
      currency: item.price?.currency || "USD",
      endDate: item.itemEndDate || null,
    }));
    return NextResponse.json({
      seller,
      query,
      total: listings.length,
      listings,
      nextStep: "The next worker will download every listing image, split multi-card photos, run InstaComp identity, and calculate lot ROI.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Seller Sweep failed." },
      { status: 400 }
    );
  }
}
