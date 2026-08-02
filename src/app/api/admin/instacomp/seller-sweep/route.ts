import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

const EBAY_API = "https://api.ebay.com";
const DEFAULT_LISTING_LIMIT = 200;
const MAX_LISTING_LIMIT = 200;
const TARGET_PLAYERS = [
  "Paige Bueckers",
  "Sonia Citron",
  "Kiki Iriafen",
  "Dominique Malonga",
  "Cameron Brink",
  "Angel Reese",
  "Hailey Van Lith",
  "Aneesah Morrow",
];

type EbayListingSummary = {
  itemId: string;
  title: string;
  itemWebUrl: string;
  imageUrl: string | null;
  price: number | null;
  shipping: number | null;
  currency: string;
  endDate: string | null;
};

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

function listingLimit(value: unknown) {
  const parsed = Number(value ?? DEFAULT_LISTING_LIMIT);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(MAX_LISTING_LIMIT, Math.floor(parsed)))
    : DEFAULT_LISTING_LIMIT;
}

function uniqueImages(item: any) {
  const urls = [
    item?.image?.imageUrl,
    ...(Array.isArray(item?.additionalImages)
      ? item.additionalImages.map((image: any) => image?.imageUrl)
      : []),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  return [...new Set(urls)];
}

function titleTargets(title: string) {
  const lower = title.toLowerCase();
  return TARGET_PLAYERS.filter((player) => lower.includes(player.toLowerCase()));
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

export async function POST(request: Request) {
  const sweepId = crypto.randomUUID();
  try {
    const body = await request.json();
    const sellerUrl = String(body?.sellerUrl || "").trim();
    const seller = extractSeller(sellerUrl);
    const query = String(body?.query || "WNBA lot").trim() || "WNBA lot";
    const limit = listingLimit(body?.limit);
    const token = await getBrowseToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    };
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
      filter: `sellers:{${seller}}`,
    });
    const response = await fetch(`${EBAY_API}/buy/browse/v1/item_summary/search?${params}`, {
      headers,
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.errors?.[0]?.message || `eBay Browse failed (${response.status}).`);
    }

    const summaries: EbayListingSummary[] = (data.itemSummaries || []).map((item: any) => ({
      itemId: String(item.itemId || ""),
      title: String(item.title || "Untitled listing"),
      itemWebUrl: String(item.itemWebUrl || item.itemAffiliateWebUrl || "#"),
      imageUrl: item.image?.imageUrl || null,
      price: numeric(item.price?.value),
      shipping: numeric(item.shippingOptions?.[0]?.shippingCost?.value),
      currency: item.price?.currency || "USD",
      endDate: item.itemEndDate || null,
    }));

    const listings = await mapWithConcurrency(summaries, 6, async (summary) => {
      try {
        const detailResponse = await fetch(
          `${EBAY_API}/buy/browse/v1/item/${encodeURIComponent(summary.itemId)}`,
          { headers, cache: "no-store" }
        );
        const detail = await detailResponse.json();
        if (!detailResponse.ok) {
          throw new Error(detail?.errors?.[0]?.message || `getItem failed (${detailResponse.status})`);
        }
        const imageUrls = uniqueImages(detail);
        return {
          ...summary,
          imageUrl: imageUrls[0] || summary.imageUrl,
          imageUrls,
          imageCount: imageUrls.length,
          status: "photos_ready" as const,
          targetPlayers: titleTargets(summary.title),
          error: null,
        };
      } catch (error) {
        const fallbackImages = summary.imageUrl ? [summary.imageUrl] : [];
        return {
          ...summary,
          imageUrls: fallbackImages,
          imageCount: fallbackImages.length,
          status: "photo_error" as const,
          targetPlayers: titleTargets(summary.title),
          error: error instanceof Error ? error.message : "Could not retrieve listing photos.",
        };
      }
    });

    const photosReady = listings.filter((listing) => listing.status === "photos_ready").length;
    const failed = listings.length - photosReady;
    const photoTotal = listings.reduce((sum, listing) => sum + listing.imageCount, 0);
    let persistenceWarning: string | null = null;

    try {
      const supabase = createSupabaseServerClient({ admin: true });
      const { error: sweepError } = await supabase.from("instacomp_seller_sweeps").insert({
        id: sweepId,
        seller_name: seller,
        seller_url: sellerUrl,
        search_query: query,
        status: "photos",
        listing_count: listings.length,
        photos_total: photoTotal,
        photos_processed: photoTotal,
        error_message: failed > 0 ? `${failed} listing photo retrieval failure(s)` : null,
      });
      if (sweepError) throw sweepError;

      if (listings.length) {
        const { error: listingError } = await supabase
          .from("instacomp_seller_sweep_listings")
          .insert(
            listings.map((listing) => ({
              id: crypto.randomUUID(),
              sweep_id: sweepId,
              ebay_item_id: listing.itemId,
              title: listing.title,
              item_url: listing.itemWebUrl,
              primary_image_url: listing.imageUrl,
              image_urls: listing.imageUrls,
              price: listing.price,
              shipping: listing.shipping,
              currency: listing.currency,
              end_date: listing.endDate,
              status: listing.status === "photos_ready" ? "photos" : "failed",
              target_players: listing.targetPlayers,
              identified_cards: [],
              error_message: listing.error,
            }))
          );
        if (listingError) throw listingError;
      }
    } catch (error) {
      persistenceWarning =
        error instanceof Error
          ? `Listings were collected, but the sweep could not be saved yet: ${error.message}`
          : "Listings were collected, but the sweep could not be saved yet.";
    }

    return NextResponse.json({
      sweepId,
      seller,
      query,
      listingLimit: limit,
      total: listings.length,
      photosReady,
      failed,
      photoTotal,
      progress: 55,
      status: failed > 0 ? "photos_ready_with_errors" : "photos_ready",
      listings,
      persistenceWarning,
      nextStep:
        "Photos are staged. The next worker will segment multi-card images, run InstaComp identity and comps, then rank ROI.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        sweepId,
        error: error instanceof Error ? error.message : "Seller Sweep failed.",
      },
      { status: 400 }
    );
  }
}
