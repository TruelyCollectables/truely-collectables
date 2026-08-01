import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { isAuthorizedMarketIntelIngest } from "../../../../lib/market-intel-ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function json(payload, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function authorized(request) {
  if (isAuthorizedMarketIntelIngest(request)) return true;
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const supplied = (request.headers.get("x-market-intel-key") || bearer).trim();
  if (!supplied) return false;
  const secrets = Array.from(
    new Set(
      [
        process.env.PENDING_RECEIVING_READ_SECRET,
        process.env.PROFIT_HUNTER_RUN_SECRET,
        process.env.MARKET_INTEL_INGEST_SECRET,
        process.env.CRON_SECRET,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  return secrets.some((secret) => secureEqual(secret, supplied));
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstText(metadata, keys) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request) {
  if (request.nextUrl.searchParams.get("statusOnly") === "1") {
    return json({
      ok: true,
      code: "PENDING_RECEIVING_LEDGER_READ_READY",
      deployment: {
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV || null,
        commitSha: String(process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 12) || null,
        region: process.env.VERCEL_REGION || null,
      },
    });
  }

  if (!authorized(request)) {
    return json({ ok: false, code: "PENDING_RECEIVING_UNAUTHORIZED" }, 401);
  }

  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const { data: lots, error: lotsError } = await supabase
      .from("tcos_mi_purchase_lots")
      .select(
        "id,purchase_number,purchased_at,status,quantity_purchased,total_acquisition_cost,unit_cost_basis,received_at,source_url,deal_label,notes,metadata,collectible_identity_id,marketplace_id",
      )
      .in("status", ["ordered", "awaiting_receipt"])
      .order("purchase_number", { ascending: true });
    if (lotsError) throw new Error(lotsError.message);

    const identityIds = Array.from(
      new Set((lots || []).map((row) => row.collectible_identity_id).filter(Boolean)),
    );
    const marketplaceIds = Array.from(
      new Set((lots || []).map((row) => row.marketplace_id).filter(Boolean)),
    );

    const [identityResult, marketplaceResult] = await Promise.all([
      identityIds.length
        ? supabase
            .from("tcos_mi_collectible_identities")
            .select("id,display_name,identity_key")
            .in("id", identityIds)
        : Promise.resolve({ data: [], error: null }),
      marketplaceIds.length
        ? supabase
            .from("tcos_mi_marketplaces")
            .select("id,name,slug")
            .in("id", marketplaceIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (identityResult.error) throw new Error(identityResult.error.message);
    if (marketplaceResult.error) throw new Error(marketplaceResult.error.message);

    const identities = new Map((identityResult.data || []).map((row) => [row.id, row]));
    const marketplaces = new Map((marketplaceResult.data || []).map((row) => [row.id, row]));
    const now = Date.now();

    const pending = (lots || []).map((lot) => {
      const metadata = record(lot.metadata);
      const identity = lot.collectible_identity_id
        ? identities.get(lot.collectible_identity_id) || null
        : null;
      const marketplace = lot.marketplace_id
        ? marketplaces.get(lot.marketplace_id) || null
        : null;
      const purchasedAtMs = new Date(lot.purchased_at).getTime();
      const ageDays = Number.isFinite(purchasedAtMs)
        ? Math.floor((now - purchasedAtMs) / 86_400_000)
        : null;
      return {
        id: lot.id,
        purchaseNumber: number(lot.purchase_number),
        purchasedAt: lot.purchased_at,
        ageDays,
        overdue7Days: ageDays !== null && ageDays >= 7,
        status: lot.status,
        quantity: number(lot.quantity_purchased),
        totalAcquisitionCost: number(lot.total_acquisition_cost),
        unitCostBasis: number(lot.unit_cost_basis),
        receivedAt: lot.received_at,
        title:
          identity?.display_name ||
          firstText(metadata, [
            "original_title",
            "item_title",
            "listing_title",
            "purchase_title",
            "title",
          ]) ||
          "Unmatched collectible",
        identityKey: identity?.identity_key || null,
        marketplace:
          marketplace?.name ||
          firstText(metadata, [
            "acquisition_source_name",
            "marketplace_name",
            "source_name",
          ]) ||
          "Unknown source",
        seller: firstText(metadata, [
          "seller_name",
          "seller",
          "ebay_seller",
          "source_seller",
        ]),
        orderNumber: firstText(metadata, [
          "order_number",
          "external_order_id",
          "ebay_order_id",
          "order_id",
        ]),
        itemNumber: firstText(metadata, [
          "item_number",
          "external_listing_id",
          "ebay_item_id",
          "listing_id",
        ]),
        trackingNumber: firstText(metadata, [
          "tracking_number",
          "tracking",
          "shipment_tracking",
        ]),
        sourceUrl: lot.source_url,
        dealLabel: lot.deal_label,
        notes: lot.notes,
      };
    });

    return json({
      ok: true,
      generatedAt: new Date().toISOString(),
      totals: {
        pendingLots: pending.length,
        pendingUnits: pending.reduce((sum, row) => sum + row.quantity, 0),
        pendingCost: Number(
          pending.reduce((sum, row) => sum + row.totalAcquisitionCost, 0).toFixed(2),
        ),
        overdue7DayLots: pending.filter((row) => row.overdue7Days).length,
      },
      pending,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        code: "PENDING_RECEIVING_LEDGER_READ_FAILED",
        error: error instanceof Error ? error.message : "Unable to read pending receiving ledger.",
      },
      500,
    );
  }
}
