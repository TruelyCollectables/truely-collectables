import "server-only";

import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "./account-auth";
import { handleActiveMarketAttackWithAccountingGuard } from "./active-market-accounting-guard";
import { auditActiveMarketSourceCoverage } from "./active-market-source-coverage";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

const OWNER_EMAILS = new Set([
  "sales@truelycollectables.com",
  "sales@trulycollectables.com",
]);

type Json = Record<string, any>;

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

function stripOldCoverageNote(value: unknown): string {
  return String(value || "")
    .replace(/\s*ACTIVE MARKET SOURCE COVERAGE (?:PASSED|BLOCKED):[\s\S]*$/i, "")
    .trim();
}

export async function handleActiveMarketAttackWithSourceCoverageGuard(
  request: Request,
  context: { params: Promise<{ inventoryItemId: string }> },
) {
  const baseResponse = await handleActiveMarketAttackWithAccountingGuard(
    request,
    context,
  );
  const payload: any = await baseResponse.json().catch(() => null);
  if (!payload || !baseResponse.ok || payload.success !== true) {
    return Response.json(
      payload || { error: "Active Market Attack Mode failed." },
      { status: baseResponse.status },
    );
  }

  const tracking = record(payload.tracking);
  if (Number(tracking.soldCompCount || 0) > 0) {
    return Response.json(payload, { status: baseResponse.status });
  }

  const account = await getAuthenticatedAccountFromRequest(request);
  if (!account) return Response.json(payload, { status: baseResponse.status });
  await ensureAccountStoreMembership({
    accountId: account.id,
    role: "seller",
    status: "active",
  });

  const { inventoryItemId } = await context.params;
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const owner = OWNER_EMAILS.has(String(account.email || "").toLowerCase());
  const { data: item, error: itemError } = await supabase
    .from("inventory_items")
    .select("id,seller_account_id,metadata")
    .eq("id", inventoryItemId)
    .eq("store_id", storeId)
    .single();
  if (itemError || !item) {
    return Response.json(payload, { status: baseResponse.status });
  }
  if (
    !(
      item.seller_account_id === account.id ||
      (owner && item.seller_account_id === null)
    )
  ) {
    return Response.json(payload, { status: baseResponse.status });
  }

  const attack = record(tracking.activeMarketAttack || payload.attack);
  const diagnostics = record(payload.diagnostics);
  const coverage = auditActiveMarketSourceCoverage({
    attack,
    tracking,
    diagnostics,
  });
  const blocked = !coverage.passed;
  const message = coverage.passed
    ? `ACTIVE MARKET SOURCE COVERAGE PASSED: ${coverage.summary}`
    : `ACTIVE MARKET SOURCE COVERAGE BLOCKED: ${coverage.failures.join(
        "; ",
      )}. ${coverage.summary}`;
  const baseTax =
    stripOldCoverageNote(attack.taxNote) ||
    "Sales tax is excluded because it varies by buyer location and is not controlled by the seller.";
  const marketLabel = String(record(attack.marketLocation).label || "US estimate")
    .replace(/\s*·\s*coverage (?:passed|blocked).*$/i, "")
    .trim();
  const nextAttack: Json = {
    ...attack,
    schema: "truely.activeMarketAttack.v13",
    sourceCoverageVersion: "active-market-source-coverage-v1",
    sourceCoverage: coverage,
    sourceCoveragePassed: coverage.passed,
    sourceCoverageFailures: coverage.failures,
    sourceCoverageWarnings: coverage.warnings,
    sourceCoverageCheckedAt: coverage.checkedAt,
    marketIntegrityStatus: blocked
      ? "blocked"
      : attack.marketIntegrityStatus || "complete",
    taxNote: `${baseTax} ${message}`,
    marketLocation: {
      ...record(attack.marketLocation),
      label: `${marketLabel} · coverage ${coverage.passed ? "passed" : "blocked"} ${coverage.metrics.queriesSucceeded}/${coverage.metrics.queriesAttempted}`,
    },
    ...(blocked
      ? {
          suggestions: [],
          lowestCompetitor: null,
          lowestCompetitorLanded: null,
          gapToLowest: null,
          position: "source_coverage_blocked",
        }
      : {}),
    updatedAt: new Date().toISOString(),
  };
  const existingReasons = Array.isArray(tracking.reviewReasons)
    ? tracking.reviewReasons
        .map(String)
        .filter(
          (reason: string) =>
            reason !== "active_market_source_coverage_passed" &&
            reason !== "active_market_source_coverage_blocked" &&
            reason !== "active_market_source_coverage_warning",
        )
    : [];
  const nextTracking: Json = {
    ...tracking,
    activeMarketAttack: nextAttack,
    trustedForPricing:
      !blocked && tracking.trustedForPricing === true,
    marketPrice: blocked ? null : tracking.marketPrice ?? null,
    deltaAmount: blocked ? null : tracking.deltaAmount ?? null,
    deltaPercent: blocked ? null : tracking.deltaPercent ?? null,
    pricingEvidenceMode: blocked
      ? "active_market_source_coverage_blocked"
      : tracking.pricingEvidenceMode,
    reviewReasons: uniqueStrings([
      ...existingReasons,
      coverage.passed
        ? "active_market_source_coverage_passed"
        : "active_market_source_coverage_blocked",
      ...(coverage.warnings.length
        ? ["active_market_source_coverage_warning"]
        : []),
    ]),
    sourceCoverage: coverage,
    updatedAt: nextAttack.updatedAt,
  };

  const metadata = record(item.metadata);
  const root = record(metadata.instacomp_tracking);
  const { error: updateError } = await supabase
    .from("inventory_items")
    .update({
      metadata: {
        ...metadata,
        instacomp_tracking: {
          ...root,
          schema: "truely.instacompInventoryTrackingHistory.v13",
          current: nextTracking,
        },
      },
      updated_at: nextTracking.updatedAt,
    })
    .eq("id", inventoryItemId)
    .eq("store_id", storeId);
  if (updateError) throw updateError;

  return Response.json({
    ...payload,
    tracking: nextTracking,
    attack: nextAttack,
    mode: blocked ? "active_market_source_coverage_blocked" : payload.mode,
    diagnostics: {
      ...diagnostics,
      sourceCoveragePassed: coverage.passed,
      sourceCoverageFailures: coverage.failures,
      sourceCoverageWarnings: coverage.warnings,
      sourceCoverageMetrics: coverage.metrics,
      sourceCoverageLanes: coverage.lanes,
      sourceCoverageCheckedAt: coverage.checkedAt,
    },
  });
}
