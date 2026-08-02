import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireUuid(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} must be a valid UUID.`);
  }
  return text;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function cardList(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export async function GET(request: NextRequest) {
  try {
    const sweepId = requireUuid(request.nextUrl.searchParams.get("sweepId"), "sweepId");
    const supabase = createSupabaseServerClient({ admin: true });
    const [{ data: sweep, error: sweepError }, { data: listingRows, error: listingError }] =
      await Promise.all([
        supabase
          .from("instacomp_seller_sweeps")
          .select(
            "id,seller_name,seller_url,search_query,status,listing_count,photos_total,photos_processed,cards_identified,listings_ranked,error_message,created_at,updated_at,completed_at",
          )
          .eq("id", sweepId)
          .maybeSingle(),
        supabase
          .from("instacomp_seller_sweep_listings")
          .select(
            "id,ebay_item_id,title,item_url,primary_image_url,image_urls,price,shipping,currency,end_date,status,target_players,identified_cards,retail_value,quick_sale_value,target_bid,hard_max_bid,expected_profit,roi_percent,confidence,rank,error_message,created_at,updated_at",
          )
          .eq("sweep_id", sweepId)
          .order("created_at", { ascending: true }),
      ]);
    if (sweepError) throw sweepError;
    if (listingError) throw listingError;
    if (!sweep) throw new Error("Seller Sweep job was not found.");

    const rows = listingRows || [];
    const total = Math.max(Number(sweep.listing_count) || 0, rows.length);
    const extracted = rows.filter((row) =>
      ["comping", "ranked", "review", "failed"].includes(String(row.status)),
    ).length;
    const valuationComplete = rows.filter(
      (row) =>
        row.status === "ranked" ||
        row.status === "failed" ||
        (row.status === "review" && row.retail_value !== null),
    ).length;

    let progress = 0;
    if (sweep.status === "completed") progress = 100;
    else if (sweep.status === "ranking") {
      progress = total ? 80 + Math.round((valuationComplete / total) * 20) : 100;
    } else if (sweep.status === "identifying") {
      progress = total ? 55 + Math.round((extracted / total) * 25) : 80;
    } else if (sweep.status === "photos") progress = 55;
    else if (sweep.status === "collecting") progress = 20;

    const listings = rows
      .map((row) => {
        const identifiedCards = cardList(row.identified_cards);
        return {
          id: String(row.id),
          itemId: String(row.ebay_item_id),
          title: String(row.title || "Untitled listing"),
          itemWebUrl: String(row.item_url || "#"),
          imageUrl: row.primary_image_url ? String(row.primary_image_url) : null,
          imageUrls: stringList(row.image_urls),
          price: numberOrNull(row.price),
          shipping: numberOrNull(row.shipping),
          currency: String(row.currency || "USD"),
          endDate: row.end_date ? String(row.end_date) : null,
          status: String(row.status),
          targetPlayers: stringList(row.target_players),
          identifiedCards,
          cardCount: identifiedCards.length,
          retailValue: numberOrNull(row.retail_value),
          quickSaleValue: numberOrNull(row.quick_sale_value),
          targetBid: numberOrNull(row.target_bid),
          hardMaxBid: numberOrNull(row.hard_max_bid),
          expectedProfit: numberOrNull(row.expected_profit),
          roiPercent: numberOrNull(row.roi_percent),
          confidence: numberOrNull(row.confidence),
          rank: numberOrNull(row.rank),
          error: row.error_message ? String(row.error_message) : null,
          updatedAt: row.updated_at ? String(row.updated_at) : null,
        };
      })
      .sort((left, right) => {
        const leftRank = left.rank ?? Number.MAX_SAFE_INTEGER;
        const rightRank = right.rank ?? Number.MAX_SAFE_INTEGER;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return (right.expectedProfit ?? Number.NEGATIVE_INFINITY) -
          (left.expectedProfit ?? Number.NEGATIVE_INFINITY);
      });

    const cardsIdentified = rows.reduce(
      (sum, row) => sum + cardList(row.identified_cards).length,
      0,
    );

    return NextResponse.json({
      ok: true,
      sweep: {
        id: String(sweep.id),
        seller: String(sweep.seller_name),
        sellerUrl: sweep.seller_url ? String(sweep.seller_url) : null,
        query: String(sweep.search_query || ""),
        status: String(sweep.status),
        error: sweep.error_message ? String(sweep.error_message) : null,
        createdAt: String(sweep.created_at),
        updatedAt: String(sweep.updated_at),
        completedAt: sweep.completed_at ? String(sweep.completed_at) : null,
      },
      summary: {
        total,
        photosTotal: Number(sweep.photos_total) || 0,
        photosProcessed: Number(sweep.photos_processed) || 0,
        cardsIdentified: Math.max(Number(sweep.cards_identified) || 0, cardsIdentified),
        ranked: rows.filter((row) => row.status === "ranked").length,
        review: rows.filter((row) => row.status === "review").length,
        failed: rows.filter((row) => row.status === "failed").length,
        pending: rows.filter((row) =>
          ["queued", "photos", "identifying", "comping"].includes(String(row.status)),
        ).length,
      },
      progress: Math.max(0, Math.min(100, progress)),
      listings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Seller Sweep status failed.",
      },
      { status: 400 },
    );
  }
}
