import { timingSafeEqual } from "node:crypto";
import { importSellerEbayOrdersBatch } from "../../../../lib/seller-ebay-orders";
import { reconcileSellerEbayInventoryBatch } from "../../../../lib/seller-ebay-reconciliation";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_CONNECTIONS_PER_INVOCATION = 1;
const START_ANOTHER_CONNECTION_BEFORE_MS = 45_000;

type ScheduledConnectionRow = {
  id: string;
  account_id: string;
  store_id: string;
};

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function validCronAuthorization(request: Request, secret: string) {
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);

  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret || secret.length < 16) {
    return Response.json(
      { error: "Scheduled reconciliation is not configured." },
      { status: 503 },
    );
  }

  if (!validCronAuthorization(request, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("seller_marketplace_connections")
    .select("id,account_id,store_id")
    .eq("provider", "ebay")
    .eq("connection_status", "connected")
    .neq("sync_status", "syncing")
    .order("last_sync_completed_at", {
      ascending: true,
      nullsFirst: true,
    })
    .limit(MAX_CONNECTIONS_PER_INVOCATION);

  if (error) {
    return Response.json(
      { error: "Could not load scheduled seller eBay connections." },
      { status: 500 },
    );
  }

  const connections = (data || []) as ScheduledConnectionRow[];
  const results: Array<{
    connectionId: string;
    success: boolean;
    orderImport: {
      success: boolean;
      importedOrderCount?: number;
      importedItemCount?: number;
      hasMore?: boolean;
      error?: string;
    };
    reconciliation: {
      success: boolean;
      runId?: string;
      scannedCount?: number;
      hasMore?: boolean;
      error?: string;
    };
  }> = [];

  for (const connection of connections) {
    if (
      results.length > 0 &&
      Date.now() - startedAt >= START_ANOTHER_CONNECTION_BEFORE_MS
    ) {
      break;
    }

    const orderImport: (typeof results)[number]["orderImport"] = {
      success: false,
    };
    const reconciliation: (typeof results)[number]["reconciliation"] = {
      success: false,
    };

    try {
      const imported = await importSellerEbayOrdersBatch({
        supabase,
        accountId: connection.account_id,
        storeId: connection.store_id,
        source: "scheduled_cron",
      });
      Object.assign(orderImport, {
        success: true,
        importedOrderCount: imported.importedOrderCount,
        importedItemCount: imported.importedItemCount,
        hasMore: imported.hasMore,
      });
    } catch (nextError: any) {
      orderImport.error = String(
        nextError.message || "Scheduled outside-order import failed.",
      ).slice(0, 300);
    }

    try {
      const result = await reconcileSellerEbayInventoryBatch({
        supabase,
        accountId: connection.account_id,
        storeId: connection.store_id,
        source: "scheduled_cron",
      });
      Object.assign(reconciliation, {
        success: true,
        runId: result.runId,
        scannedCount: result.scannedCount,
        hasMore: result.hasMore,
      });
    } catch (nextError: any) {
      reconciliation.error = String(
          nextError.message || "Scheduled reconciliation failed.",
        ).slice(0, 300);
    }

    results.push({
      connectionId: connection.id,
      success: orderImport.success && reconciliation.success,
      orderImport,
      reconciliation,
    });
  }

  const failureCount = results.filter((result) => !result.success).length;

  return Response.json({
    success: failureCount === 0,
    selectedCount: connections.length,
    processedCount: results.length,
    successCount: results.length - failureCount,
    failureCount,
    deferredCount: Math.max(connections.length - results.length, 0),
    durationMs: Date.now() - startedAt,
    results,
  });
}
