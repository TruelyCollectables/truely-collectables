import "server-only";

import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "./account-auth";
import { handleActiveMarketAttackWithConsensusGuard } from "./active-market-consensus-guard";
import { auditActiveMarketIntegrity } from "./active-market-integrity-audit";
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

function stripOldIntegrityNote(value: unknown): string {
  return String(value || "")
    .replace(/\s*ACTIVE MARKET INTEGRITY (?:PASSED|BLOCKED):[\s\S]*$/i, "")
    .trim();
}

export async function handleActiveMarketAttackWithIntegrityGuard(
  request: Request,
  context: { params: Promise<{ inventoryItemId: string }> },
) {
  const baseResponse = await handleActiveMarketAttackWithConsensusGuard(
    request,
    context,
  );
  const payload: any = await baseResponse.json().catch(() => null);
  if (!payload || !baseResponse.ok || payload.success !== true) {
    return Response.json(payload || { error: "Active Market Attack Mode failed." }, {
      status: baseResponse.status,
    });
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
  if (itemError || !item) return Response.json(payload, { status: baseResponse.status });
  if (!(item.seller_account_id === account.id || (owner && item.seller_account_id === null))) {
    return Response.json(payload, { status: baseResponse.status });
  }

  const attack = record(tracking.activeMarketAttack || payload.attack);
  const diagnostics = record(payload.diagnostics);
  const audit = auditActiveMarketIntegrity({
    attack,
    tracking,
    selfListingId: String(diagnostics.selfListingId || "").trim() || null,
  });
  const message = audit.passed
    ? "ACTIVE MARKET INTEGRITY PASSED: seller listing separation, packaging states, candidate counts, and landed-price math reconciled."
    : `ACTIVE MARKET INTEGRITY BLOCKED: ${audit.failures.join(
        "; ",
      )}. No active-market pricing recommendation is trusted.`;
  const baseTax =
    stripOldIntegrityNote(attack.taxNote) ||
    "Sales tax is excluded because it varies by buyer location and is not controlled by the seller.";
  const marketLabel = String(record(attack.marketLocation).label || "US estimate")
    .replace(/\s*·\s*integrity (?:passed|blocked).*$/i, "")
    .trim();
  const nextAttack: Json = {
    ...attack,
    schema: "truely.activeMarketAttack.v15",
    integrityAuditVersion: "active-market-integrity-v1",
    integrityAuditPassed: audit.passed,
    integrityAuditFailures: audit.failures,
    integrityAuditWarnings: audit.warnings,
    integrityAuditCheckedAt: audit.checkedAt,
    integrityAuditMetrics: audit.metrics,
    marketIntegrityStatus: audit.passed
      ? attack.marketIntegrityStatus || "complete"
      : "blocked",
    taxNote: `${baseTax} ${message}`,
    marketLocation: {
      ...record(attack.marketLocation),
      label: `${marketLabel} · integrity ${audit.passed ? "passed" : "blocked"}`,
    },
    ...(audit.passed
      ? {}
      : {
          suggestions: [],
          lowestCompetitor: null,
          lowestCompetitorLanded: null,
          gapToLowest: null,
          position: "integrity_blocked",
        }),
    updatedAt: new Date().toISOString(),
  };
  const existingReasons = Array.isArray(tracking.reviewReasons)
    ? tracking.reviewReasons
        .map(String)
        .filter(
          (reason: string) =>
            reason !== "active_market_integrity_audit_passed" &&
            reason !== "active_market_integrity_audit_blocked",
        )
    : [];
  const nextTracking: Json = {
    ...tracking,
    activeMarketAttack: nextAttack,
    trustedForPricing: audit.passed ? tracking.trustedForPricing === true : false,
    marketPrice: audit.passed ? tracking.marketPrice ?? null : null,
    deltaAmount: audit.passed ? tracking.deltaAmount ?? null : null,
    deltaPercent: audit.passed ? tracking.deltaPercent ?? null : null,
    pricingEvidenceMode: audit.passed
      ? tracking.pricingEvidenceMode
      : "active_market_integrity_blocked",
    reviewReasons: uniqueStrings([
      ...existingReasons,
      audit.passed
        ? "active_market_integrity_audit_passed"
        : "active_market_integrity_audit_blocked",
    ]),
    integrityAudit: audit,
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
          schema: "truely.instacompInventoryTrackingHistory.v15",
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
    mode: audit.passed ? payload.mode : "active_market_integrity_blocked",
    diagnostics: {
      ...diagnostics,
      integrityAuditPassed: audit.passed,
      integrityAuditFailures: audit.failures,
      integrityAuditWarnings: audit.warnings,
      integrityAuditCheckedAt: audit.checkedAt,
      integrityAuditMetrics: audit.metrics,
    },
  });
}
