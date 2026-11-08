import { NextRequest, NextResponse } from "next/server";
import { requireInstaCompJobActor } from "../../../../../../lib/instacomp-job-server";
import { getKingmakerPricingReceiptHistory } from "../../../../../../lib/kingmaker-pricing-receipt-history-server";
import { summarizePricingReceipts } from "../../../../../../lib/kingmaker-pricing-receipt-operations";
import {
  comparePricingReceipts,
  filterAndPaginatePricingReceipts,
  type PricingReceiptStatus,
} from "../../../../../../lib/kingmaker-pricing-operations-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statuses = new Set<PricingReceiptStatus>(["ready", "review_required", "insufficient_evidence"]);

function optionalNumber(value: string | null) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const url = new URL(request.url);
    const statusValue = url.searchParams.get("status") as PricingReceiptStatus | null;
    const status = statusValue && statuses.has(statusValue) ? statusValue : null;
    const compareIds = url.searchParams.getAll("compareId").slice(0, 5);
    const fetchLimit = Math.max(1, Math.min(Number(url.searchParams.get("fetchLimit") || 1000), 1000));
    const receipts = await getKingmakerPricingReceiptHistory({ actor, limit: fetchLimit });
    const filtered = filterAndPaginatePricingReceipts(receipts, {
      status,
      identityId: url.searchParams.get("identityId"),
      profileName: url.searchParams.get("profileName"),
      minConfidence: optionalNumber(url.searchParams.get("minConfidence")),
      minEstimatedProfit: optionalNumber(url.searchParams.get("minEstimatedProfit")),
      createdFrom: url.searchParams.get("createdFrom"),
      createdTo: url.searchParams.get("createdTo"),
      page: optionalNumber(url.searchParams.get("page")) || 1,
      pageSize: optionalNumber(url.searchParams.get("pageSize")) || 25,
    });

    return NextResponse.json({
      ok: true,
      receipts: filtered.rows,
      pagination: filtered.pagination,
      analytics: summarizePricingReceipts(filtered.rows),
      comparison: compareIds.length ? comparePricingReceipts(receipts, compareIds) : null,
      sourceDisclosure: null,
      boundary: "advisory_only",
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load pricing operations.";
    const status = message.includes("AUTH") || message.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
