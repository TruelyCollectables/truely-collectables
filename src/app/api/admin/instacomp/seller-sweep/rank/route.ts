import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  calculateSellerSweepLotEconomics,
  type SellerSweepValuedCard,
} from "@/lib/instacomp-seller-sweep-economics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 50;

function requireUuid(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} must be a valid UUID.`);
  }
  return text;
}

function batchSize(value: unknown) {
  const parsed = Number(value ?? DEFAULT_BATCH_SIZE);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(parsed)))
    : DEFAULT_BATCH_SIZE;
}

function cards(value: unknown): SellerSweepValuedCard[] {
  return Array.isArray(value) ? (value as SellerSweepValuedCard[]) : [];
}

function rankScore(row: {
  expectedProfit: number | null;
  roiPercent: number | null;
  confidence: number | null;
  targetPlayers: string[];
}) {
  const profit = Math.max(0, Number(row.expectedProfit) || 0);
  const roi = Math.max(0, Number(row.roiPercent) || 0);
  const confidence = Math.max(0, Math.min(1, Number(row.confidence) || 0));
  return profit * 3 + roi * 0.75 + confidence * 25 + row.targetPlayers.length * 12;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sweepId = requireUuid(body?.sweepId, "sweepId");
    const limit = batchSize(body?.batchSize);
    const supabase = createSupabaseServerClient({ admin: true });

    const { data: sweep, error: sweepError } = await supabase
      .from("instacomp_seller_sweeps")
      .select("id,status,listing_count")
      .eq("id", sweepId)
      .maybeSingle();
    if (sweepError) throw sweepError;
    if (!sweep) throw new Error("Seller Sweep job was not found.");

    const { data: listings, error: listingError } = await supabase
      .from("instacomp_seller_sweep_listings")
      .select(
        "id,ebay_item_id,title,item_url,price,shipping,status,target_players,identified_cards,confidence",
      )
      .eq("sweep_id", sweepId)
      .in("status", ["comping", "review"])
      .order("created_at", { ascending: true })
      .limit(limit);
    if (listingError) throw listingError;

    const outcomes = [];
    for (const listing of listings || []) {
      const economics = calculateSellerSweepLotEconomics({
        cards: cards(listing.identified_cards),
        itemPrice: listing.price,
        inboundShipping: listing.shipping,
      });
      const status = economics.status === "ranked" ? "ranked" : "review";
      const { error: updateError } = await supabase
        .from("instacomp_seller_sweep_listings")
        .update({
          status,
          retail_value: economics.retailValue,
          quick_sale_value: economics.quickSaleValue,
          target_bid: economics.targetBid,
          hard_max_bid: economics.hardMaxBid,
          expected_profit: economics.expectedProfit,
          roi_percent: economics.roiPercent,
          error_message:
            economics.status === "review"
              ? `Valuation blocked: ${economics.reasons.join(", ")}`
              : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", listing.id);
      if (updateError) throw updateError;

      outcomes.push({
        listingId: listing.id,
        ebayItemId: listing.ebay_item_id,
        title: listing.title,
        itemUrl: listing.item_url,
        targetPlayers: Array.isArray(listing.target_players)
          ? listing.target_players
          : [],
        confidence: Number(listing.confidence) || 0,
        status,
        ...economics,
      });
    }

    const { data: allRows, error: allError } = await supabase
      .from("instacomp_seller_sweep_listings")
      .select(
        "id,status,target_players,expected_profit,roi_percent,confidence,rank",
      )
      .eq("sweep_id", sweepId);
    if (allError) throw allError;

    const rankedRows = (allRows || [])
      .filter((row) => row.status === "ranked")
      .map((row) => ({
        ...row,
        targetPlayers: Array.isArray(row.target_players)
          ? row.target_players
          : [],
      }))
      .sort(
        (left, right) =>
          rankScore({
            expectedProfit: right.expected_profit,
            roiPercent: right.roi_percent,
            confidence: right.confidence,
            targetPlayers: right.targetPlayers,
          }) -
          rankScore({
            expectedProfit: left.expected_profit,
            roiPercent: left.roi_percent,
            confidence: left.confidence,
            targetPlayers: left.targetPlayers,
          }),
      );

    for (let index = 0; index < rankedRows.length; index += 1) {
      const { error: rankError } = await supabase
        .from("instacomp_seller_sweep_listings")
        .update({ rank: index + 1, updated_at: new Date().toISOString() })
        .eq("id", rankedRows[index].id);
      if (rankError) throw rankError;
    }

    const rows = allRows || [];
    const stillComping = rows.filter((row) => row.status === "comping").length;
    const rankedCount = rankedRows.length;
    const reviewCount = rows.filter((row) => row.status === "review").length;
    const complete = stillComping === 0;

    await supabase
      .from("instacomp_seller_sweeps")
      .update({
        status: complete ? "completed" : "ranking",
        listings_ranked: rankedCount,
        completed_at: complete ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sweepId);

    return NextResponse.json({
      ok: true,
      sweepId,
      processedThisRun: outcomes.length,
      rankedCount,
      reviewCount,
      remaining: stillComping,
      progress: complete ? 100 : 90,
      status: complete ? "completed" : "ranking",
      outcomes,
      safetyBoundary:
        "Unverified cards and cards with fewer than two independently verified completed sales remain review-only with $0 projected value.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Seller Sweep ranking failed.",
      },
      { status: 400 },
    );
  }
}
