import "server-only";

import { randomUUID } from "node:crypto";
import {
  ensureAccountStoreMembership,
  getAuthenticatedSellerAccountFromRequest,
} from "./account-auth";
import {
  appendActiveMarketScanHistory,
  buildRunningActiveMarketScanLease,
  finishActiveMarketScanLease,
  inspectActiveMarketScanLease,
  isActiveMarketScanLeaseOwner,
  readActiveMarketScanLease,
  type ActiveMarketScanLease,
} from "./active-market-scan-lease";
import { handleActiveMarketAttackWithSourceCoverageGuard } from "./active-market-source-coverage-guard";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

const OWNER_EMAILS = new Set([
  "sales@truelycollectables.com",
  "sales@trulycollectables.com",
]);
const LEASE_TTL_MS = 5 * 60_000;

type Json = Record<string, any>;

type InventoryLeaseRow = {
  id: string;
  seller_account_id: string | null;
  metadata: Json | null;
  updated_at: string | null;
};

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

function publicLease(lease: ActiveMarketScanLease | null) {
  if (!lease) return null;
  return {
    runId: lease.runId,
    status: lease.status,
    startedAt: lease.startedAt,
    expiresAt: lease.expiresAt,
    completedAt: lease.completedAt || null,
    responseStatus: lease.responseStatus ?? null,
    resultMode: lease.resultMode || null,
    evidenceReceipt: lease.evidenceReceipt || null,
    error: lease.error || null,
  };
}

function runningTracking(metadata: Json, runId: string, startedAt: string) {
  const root = record(metadata.instacomp_tracking);
  const current = record(root.current);
  const attack = record(current.activeMarketAttack);
  return {
    ...metadata,
    active_market_scan_lease: metadata.active_market_scan_lease,
    instacomp_tracking: {
      ...root,
      current: {
        ...current,
        trustedForPricing: false,
        pricingEvidenceMode: "active_market_scan_running",
        reviewReasons: uniqueStrings([
          ...(Array.isArray(current.reviewReasons) ? current.reviewReasons : []),
          "active_market_scan_running",
        ]),
        activeMarketScanRunId: runId,
        activeMarketScanStartedAt: startedAt,
        activeMarketAttack: Object.keys(attack).length
          ? {
              ...attack,
              suggestions: [],
              lowestCompetitor: null,
              lowestCompetitorLanded: null,
              gapToLowest: null,
              position: "scan_running",
            }
          : current.activeMarketAttack,
        updatedAt: startedAt,
      },
    },
  };
}

async function finalizeLease(input: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  inventoryItemId: string;
  runningLease: ActiveMarketScanLease;
  status: "completed" | "failed" | "superseded";
  responseStatus: number;
  resultMode: string | null;
  evidenceReceipt: string | null;
  error: string | null;
}) {
  const { data: latest, error: latestError } = await input.supabase
    .from("inventory_items")
    .select("id,metadata")
    .eq("id", input.inventoryItemId)
    .eq("store_id", input.storeId)
    .single();
  if (latestError || !latest) return null;

  const latestMetadata = record(latest.metadata);
  if (!isActiveMarketScanLeaseOwner(latestMetadata, input.runningLease.runId)) {
    return finishActiveMarketScanLease({
      lease: input.runningLease,
      status: "superseded",
      responseStatus: 409,
      resultMode: "active_market_scan_superseded",
      evidenceReceipt: input.evidenceReceipt,
      error:
        "This scan lost ownership before it finished and was not allowed to finalize.",
    });
  }

  const finished = finishActiveMarketScanLease({
    lease: input.runningLease,
    status: input.status,
    responseStatus: input.responseStatus,
    resultMode: input.resultMode,
    evidenceReceipt: input.evidenceReceipt,
    error: input.error,
  });
  const root = record(latestMetadata.instacomp_tracking);
  const current = record(root.current);
  const attack = record(current.activeMarketAttack);
  const failed = input.status !== "completed";
  const nextCurrent = {
    ...current,
    trustedForPricing: failed ? false : current.trustedForPricing === true,
    pricingEvidenceMode: failed
      ? "active_market_scan_failed"
      : current.pricingEvidenceMode,
    reviewReasons: uniqueStrings([
      ...(Array.isArray(current.reviewReasons) ? current.reviewReasons : []).filter(
        (reason: unknown) => String(reason) !== "active_market_scan_running",
      ),
      ...(failed ? ["active_market_scan_failed"] : []),
    ]),
    activeMarketScanRunId: finished.runId,
    activeMarketScanStartedAt: finished.startedAt,
    activeMarketScanCompletedAt: finished.completedAt,
    activeMarketAttack:
      failed && Object.keys(attack).length
        ? {
            ...attack,
            suggestions: [],
            lowestCompetitor: null,
            lowestCompetitorLanded: null,
            gapToLowest: null,
            position: "scan_failed",
          }
        : current.activeMarketAttack,
  };
  const nextMetadata = {
    ...latestMetadata,
    active_market_scan_lease: finished,
    active_market_scan_history: appendActiveMarketScanHistory({
      metadata: latestMetadata,
      lease: finished,
      limit: 20,
    }),
    instacomp_tracking: {
      ...root,
      current: nextCurrent,
    },
  };
  const completedAt = finished.completedAt || new Date().toISOString();
  const { error: updateError } = await input.supabase
    .from("inventory_items")
    .update({
      metadata: nextMetadata,
      updated_at: completedAt,
    })
    .eq("id", input.inventoryItemId)
    .eq("store_id", input.storeId);
  if (updateError) throw updateError;
  return finished;
}

export async function handleActiveMarketAttackWithConcurrencyGuard(
  request: Request,
  context: { params: Promise<{ inventoryItemId: string }> },
) {
  const account = await getAuthenticatedSellerAccountFromRequest(request);
  if (!account) {
    return Response.json({ error: "Log in to run Active Market Attack Mode." }, { status: 401 });
  }
  await ensureAccountStoreMembership({
    accountId: account.id,
    role: "seller",
    status: "active",
  });

  const { inventoryItemId } = await context.params;
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const owner = OWNER_EMAILS.has(String(account.email || "").toLowerCase());
  const { data, error } = await supabase
    .from("inventory_items")
    .select("id,seller_account_id,metadata,updated_at")
    .eq("id", inventoryItemId)
    .eq("store_id", storeId)
    .single();
  if (error || !data) {
    return Response.json({ error: "Inventory item was not found." }, { status: 404 });
  }

  const item = data as InventoryLeaseRow;
  if (
    !(
      item.seller_account_id === account.id ||
      (owner && item.seller_account_id === null)
    )
  ) {
    return Response.json({ error: "Inventory item was not found." }, { status: 404 });
  }

  const metadata = record(item.metadata);
  const leaseState = inspectActiveMarketScanLease({ metadata });
  if (!leaseState.canAcquire) {
    const seconds = Math.max(1, Math.ceil(leaseState.remainingMs / 1000));
    return Response.json(
      {
        error: `An Active Market scan is already running for this card. Wait about ${seconds} seconds before starting another scan.`,
        mode: "active_market_scan_already_running",
        scanLease: publicLease(leaseState.lease),
      },
      { status: 409 },
    );
  }

  const runningLease = buildRunningActiveMarketScanLease({
    runId: randomUUID(),
    ownerAccountId: account.id,
    ttlMs: LEASE_TTL_MS,
  });
  const lockMetadata = runningTracking(
    {
      ...metadata,
      active_market_scan_lease: runningLease,
    },
    runningLease.runId,
    runningLease.startedAt,
  );
  let acquireQuery = supabase
    .from("inventory_items")
    .update({
      metadata: lockMetadata,
      updated_at: runningLease.startedAt,
    })
    .eq("id", inventoryItemId)
    .eq("store_id", storeId);
  acquireQuery = item.updated_at
    ? acquireQuery.eq("updated_at", item.updated_at)
    : acquireQuery.is("updated_at", null);
  const { data: acquired, error: acquireError } = await acquireQuery
    .select("id")
    .maybeSingle();
  if (acquireError) throw acquireError;
  if (!acquired) {
    return Response.json(
      {
        error:
          "This card changed while the market scan was starting. Nothing was overwritten. Run the scan again.",
        mode: "active_market_scan_start_conflict",
      },
      { status: 409 },
    );
  }

  try {
    const baseResponse = await handleActiveMarketAttackWithSourceCoverageGuard(
      request,
      context,
    );
    const payload: any = await baseResponse.json().catch(() => null);
    const successful =
      baseResponse.ok && payload && payload.success === true;
    const attack = record(payload?.attack || record(payload?.tracking).activeMarketAttack);
    const evidenceReceipt =
      String(
        attack.evidenceAccountingReceipt ||
          record(payload?.tracking).evidenceAccountingReceipt ||
          "",
      ).trim() || null;
    const resultMode = String(payload?.mode || "").trim() || null;
    const errorMessage = successful
      ? null
      : String(payload?.error || "Active Market Attack Mode failed.").slice(0, 500);
    const finished = await finalizeLease({
      supabase,
      storeId,
      inventoryItemId,
      runningLease,
      status: successful ? "completed" : "failed",
      responseStatus: baseResponse.status,
      resultMode,
      evidenceReceipt,
      error: errorMessage,
    });

    if (finished?.status === "superseded") {
      return Response.json(
        {
          success: false,
          error:
            "This market scan was superseded by a newer run and was not allowed to finalize or change trusted pricing.",
          mode: "active_market_scan_superseded",
          scanLease: publicLease(finished),
        },
        { status: 409 },
      );
    }

    return Response.json(
      {
        ...(payload || {
          success: false,
          error: errorMessage || "Active Market Attack Mode failed.",
        }),
        scanLease: publicLease(finished),
        diagnostics: {
          ...record(payload?.diagnostics),
          activeMarketScanRunId: runningLease.runId,
          activeMarketScanLeaseStatus: finished?.status || "unknown",
          activeMarketScanStartedAt: runningLease.startedAt,
          activeMarketScanCompletedAt: finished?.completedAt || null,
        },
      },
      { status: baseResponse.status },
    );
  } catch (scanError) {
    const message =
      scanError instanceof Error
        ? scanError.message
        : "Active Market Attack Mode failed.";
    const finished = await finalizeLease({
      supabase,
      storeId,
      inventoryItemId,
      runningLease,
      status: "failed",
      responseStatus: 500,
      resultMode: "active_market_scan_failed",
      evidenceReceipt: null,
      error: message.slice(0, 500),
    }).catch(() => null);
    return Response.json(
      {
        success: false,
        error: message,
        mode: "active_market_scan_failed",
        scanLease: publicLease(finished || readActiveMarketScanLease(lockMetadata)),
      },
      { status: 500 },
    );
  }
}
