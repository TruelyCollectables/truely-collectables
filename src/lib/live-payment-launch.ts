import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "./supabase-server";
import { getStripeLiveSecretKey } from "./stripe-credentials";
import { getActiveStoreId } from "./stores";
import {
  evaluateLivePaymentLaunch as evaluateLivePaymentLaunchCore,
  type LivePaymentCheck,
  type LivePaymentLaunchReport,
  type LivePaymentNextAction,
  type LivePaymentLaunchSummary,
} from "./live-payment-launch-core";

export * from "./live-payment-launch-core";

type SellerPayoutAccountRow = {
  provider_account_id?: string | null;
  metadata?: unknown;
};

const approvalExclusions = new Set(["database_approval", "runtime_switch"]);

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function isInternalPlatformStoreOwnerPayoutAccount(
  row: SellerPayoutAccountRow,
  storeId: string,
) {
  const metadata = metadataRecord(row.metadata);

  return (
    row.provider_account_id === `platform_store_owner:${storeId}` &&
    metadata.settlement_mode === "platform_store_owner" &&
    metadata.connect_required === false &&
    metadata.platform_stripe_account === true &&
    metadata.provider_account_id_kind === "internal_platform_owner"
  );
}

export function isExternalStripeConnectAccountId(value: unknown): value is string {
  return /^acct_[A-Za-z0-9]+$/.test(String(value || ""));
}

function actionForCheck(
  check: LivePaymentCheck,
  priorActions: Map<string, string>,
) {
  const prior = priorActions.get(check.key);
  if (prior) return prior;

  if (check.key === "seller_connect") {
    return "Confirm every external acct_ Stripe Connect seller is live and payout-enabled. Internal platform-store-owner settlement records do not require Connect onboarding.";
  }

  if (check.key === "database_approval") {
    return "Record the auditable database approval after all approval blockers are clear.";
  }

  if (check.key === "runtime_switch") {
    return "Keep the runtime switch locked until the final go-live window.";
  }

  return "Review this launch check before enabling live Checkout.";
}

function rebuildReport(
  report: LivePaymentLaunchReport,
  checks: LivePaymentCheck[],
): LivePaymentLaunchReport {
  const priorActions = new Map(
    [
      ...report.summary.approvalBlockers,
      ...report.summary.launchLocks,
      ...report.summary.warnings,
      ...report.summary.nextActions,
    ].map((item) => [item.key, item.action]),
  );
  const withAction = (item: LivePaymentCheck): LivePaymentNextAction => ({
    ...item,
    action: actionForCheck(item, priorActions),
  });
  const approvalBlockers = checks
    .filter(
      (item) => item.status === "blocked" && !approvalExclusions.has(item.key),
    )
    .map(withAction);
  const launchLocks = checks
    .filter(
      (item) => item.status === "blocked" && approvalExclusions.has(item.key),
    )
    .map(withAction);
  const warnings = checks
    .filter((item) => item.status === "warning")
    .map(withAction);
  const passedCount = checks.filter((item) => item.status === "passed").length;
  const blockedCount = checks.filter((item) => item.status === "blocked").length;
  const databaseApproved = report.summary.databaseApproved;
  const runtimeSwitchEnabled = report.summary.runtimeSwitchEnabled;
  const approvalReady = approvalBlockers.length === 0;
  const livePaymentsEnabled =
    approvalReady && databaseApproved && runtimeSwitchEnabled;
  const operatorSummary = livePaymentsEnabled
    ? "Live Checkout is enabled. Keep monitoring Stripe webhooks, reconciliation, refunds, disputes, seller payout holds, and emergency revocation."
    : approvalBlockers.length > 0
      ? `Live Checkout is locked with ${approvalBlockers.length} approval blocker(s). Clear these before recording database approval.`
      : !databaseApproved && !runtimeSwitchEnabled
        ? "Approval blockers are clear. Record the database approval when the operator is ready, then leave TCOS_LIVE_PAYMENTS_ENABLED off until the final go-live window."
        : !databaseApproved
          ? "Approval blockers are clear. Record the auditable database approval before live Checkout can open."
          : !runtimeSwitchEnabled
            ? "Database approval is current. TCOS_LIVE_PAYMENTS_ENABLED remains the final runtime lock before live Checkout opens."
            : "Live Checkout is locked by the launch gate state. Review database approval and runtime switch evidence before proceeding.";
  const summary: LivePaymentLaunchSummary = {
    totalChecks: checks.length,
    passedCount,
    warningCount: warnings.length,
    blockedCount,
    approvalBlockingCount: approvalBlockers.length,
    launchLockCount: launchLocks.length,
    databaseApproved,
    runtimeSwitchEnabled,
    operatorSummary,
    approvalBlockers,
    launchLocks,
    warnings,
    nextActions: [...approvalBlockers, ...launchLocks, ...warnings],
  };

  return {
    ...report,
    checks,
    approvalReady,
    livePaymentsEnabled,
    summary,
  };
}

export async function evaluateLivePaymentLaunch(params?: {
  supabase?: SupabaseClient;
  storeId?: string;
}): Promise<LivePaymentLaunchReport> {
  const report = await evaluateLivePaymentLaunchCore(params);
  const sellerCheckIndex = report.checks.findIndex(
    (item) => item.key === "seller_connect",
  );

  if (sellerCheckIndex < 0) return report;

  const supabase =
    params?.supabase || createSupabaseServerClient({ admin: true });
  const storeId = params?.storeId || getActiveStoreId();
  const sellerAccountsResult = await supabase
    .from("seller_payout_accounts")
    .select("provider_account_id,metadata")
    .eq("store_id", storeId)
    .eq("provider", "stripe_connect");

  let sellerCheck: LivePaymentCheck;

  if (sellerAccountsResult.error) {
    sellerCheck = {
      key: "seller_connect",
      label: "Stripe Connect Sellers",
      status: "blocked",
      detail: `Seller payout accounts could not be verified: ${sellerAccountsResult.error.message}`,
    };
  } else {
    const rows = (sellerAccountsResult.data || []) as SellerPayoutAccountRow[];
    const internalOwnerRows = rows.filter((row) =>
      isInternalPlatformStoreOwnerPayoutAccount(row, storeId),
    );
    const externalRows = rows.filter(
      (row) => !isInternalPlatformStoreOwnerPayoutAccount(row, storeId),
    );
    const invalidExternalRows = externalRows.filter(
      (row) => !isExternalStripeConnectAccountId(row.provider_account_id),
    );
    const externalAccountIds = Array.from(
      new Set(
        externalRows
          .map((row) => row.provider_account_id)
          .filter(isExternalStripeConnectAccountId),
      ),
    );

    if (invalidExternalRows.length > 0) {
      sellerCheck = {
        key: "seller_connect",
        label: "Stripe Connect Sellers",
        status: "blocked",
        detail: `${invalidExternalRows.length} external seller payout row(s) have invalid Stripe Connect account IDs. Real connected accounts must use acct_ IDs.`,
      };
    } else if (externalAccountIds.length === 0) {
      sellerCheck = {
        key: "seller_connect",
        label: "Stripe Connect Sellers",
        status: "passed",
        detail:
          internalOwnerRows.length > 0
            ? `${internalOwnerRows.length} internal platform-store-owner settlement record(s) correctly bypass Connect onboarding; no external seller requires payout activation yet.`
            : "No external connected seller requires live payout activation yet.",
      };
    } else if (externalAccountIds.length > 100) {
      sellerCheck = {
        key: "seller_connect",
        label: "Stripe Connect Sellers",
        status: "blocked",
        detail: "More than 100 external Stripe Connect sellers require verification. Review the excess rows before live approval.",
      };
    } else {
      const liveStripeKey = getStripeLiveSecretKey();

      if (!liveStripeKey) {
        sellerCheck = {
          key: "seller_connect",
          label: "Stripe Connect Sellers",
          status: "blocked",
          detail: "Live Stripe credentials are required to verify external connected sellers.",
        };
      } else {
        const stripe = new Stripe(liveStripeKey);
        const verification = await Promise.all(
          externalAccountIds.map(async (accountId) => {
            try {
              const account = await stripe.accounts.retrieve(accountId);
              return !(
                "deleted" in account && account.deleted
              ) && account.details_submitted === true && account.payouts_enabled === true;
            } catch {
              return false;
            }
          }),
        );
        const failedCount = verification.filter((passed) => !passed).length;

        sellerCheck = {
          key: "seller_connect",
          label: "Stripe Connect Sellers",
          status: failedCount === 0 ? "passed" : "blocked",
          detail:
            failedCount === 0
              ? `${externalAccountIds.length} external connected seller account(s) are live and payout-enabled${internalOwnerRows.length > 0 ? `; ${internalOwnerRows.length} internal owner settlement record(s) were correctly excluded` : ""}.`
              : `${failedCount} of ${externalAccountIds.length} external connected seller account(s) are invalid, incomplete, or not payout-enabled in live mode.`,
        };
      }
    }
  }

  const checks = [...report.checks];
  checks[sellerCheckIndex] = sellerCheck;
  return rebuildReport(report, checks);
}
