import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "./supabase-server";
import { getStoreSettings } from "./store-settings";
import { getActiveStoreId } from "./stores";
import { getDryRunShippingCleanupSummary } from "./shipping-dry-run-cleanup";
import {
  getStripeLivePublishableKey,
  getStripeLiveSecretKey,
  getStripeLiveWebhookSecret,
  getStripeTestSecretKey,
  stripeCredentialShape,
} from "./stripe-credentials";

export const LIVE_PAYMENT_APPROVAL_VERSION = "tcos-live-payments-v1";
export const REQUIRED_LIVE_WEBHOOK_EVENTS = [
  "account.updated",
  "checkout.session.completed",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
] as const;

export type LivePaymentCheckStatus = "passed" | "warning" | "blocked";

export type LivePaymentCheck = {
  key: string;
  label: string;
  status: LivePaymentCheckStatus;
  detail: string;
};

export type LivePaymentNextAction = LivePaymentCheck & {
  action: string;
};

export type LivePaymentLaunchSummary = {
  totalChecks: number;
  passedCount: number;
  warningCount: number;
  blockedCount: number;
  approvalBlockingCount: number;
  launchLockCount: number;
  databaseApproved: boolean;
  runtimeSwitchEnabled: boolean;
  operatorSummary: string;
  approvalBlockers: LivePaymentNextAction[];
  launchLocks: LivePaymentNextAction[];
  warnings: LivePaymentNextAction[];
  nextActions: LivePaymentNextAction[];
};

export type LivePaymentLaunchReport = {
  approvalVersion: string;
  generatedAt: string;
  paymentMode: "live" | "test" | "mixed" | "missing";
  credentialDiagnostics: {
    liveSecretKeyRecognized: boolean;
    liveSecretKeyShape: string;
    livePublishableKeyRecognized: boolean;
    livePublishableKeyShape: string;
    liveWebhookSecretRecognized: boolean;
    testSecretKeyRecognized: boolean;
    livePaymentsSwitchEnabled: boolean;
    liveFinancialEventsVerified: boolean;
  };
  approvalDatabaseReady: boolean;
  approvalReady: boolean;
  livePaymentsEnabled: boolean;
  summary: LivePaymentLaunchSummary;
  checks: LivePaymentCheck[];
};

type GateRow = {
  gate_status?: string | null;
  approval_version?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
};

function paymentMode() {
  if (getStripeLiveSecretKey() && getStripeLivePublishableKey()) {
    return "live" as const;
  }
  if (getStripeTestSecretKey()) return "test" as const;
  return "missing" as const;
}

function productionOrigin(primaryDomain: string | null) {
  const configuredSite = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const raw = configuredSite || primaryDomain?.trim() || vercelProductionUrl;
  if (!raw) return null;

  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function check(
  key: string,
  label: string,
  status: LivePaymentCheckStatus,
  detail: string,
): LivePaymentCheck {
  return { key, label, status, detail };
}

function safeCount(value: number | null) {
  return Number.isFinite(value) ? Number(value) : 0;
}

const approvalExclusions = new Set(["database_approval", "runtime_switch"]);

function actionForLivePaymentCheck(check: LivePaymentCheck) {
  switch (check.key) {
    case "database_approval":
      return "Record the auditable database approval from /admin/live-payment-launch after all approval blockers are clear.";
    case "runtime_switch":
      return "Set TCOS_LIVE_PAYMENTS_ENABLED=true only during the final go-live window after database approval is current.";
    case "stripe_key_mode":
      return "Stage matching STRIPE_LIVE_SECRET_KEY and NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY values in production.";
    case "production_origin":
      return "Set NEXT_PUBLIC_SITE_URL or the store primary domain to the HTTPS production origin.";
    case "platform_fee":
      return "Restore the active store seller commission rate to the approved 8% launch fee.";
    case "checkout_e2e":
      return "Run the isolated checkout-to-refund E2E suite and save a passing run with at least eight scenarios.";
    case "unmatched_money":
      return "Clear open stripe_reconciliation_items before accepting live buyer payments.";
    case "test_residue":
      return "Remove TCOS test orders and disposable test products from the production store.";
    case "dry_run_shipping_cleanup":
      return "Complete dry-run shipping cleanup so live payments cannot point at simulated shipping proof.";
    case "monthly_subscription":
      return "Keep TCOS_MONTHLY_SUBSCRIPTION_ENABLED disabled for this launch.";
    case "webhook_secret":
      return "Configure the live Stripe webhook signing secret for /api/webhook.";
    case "financial_event_verification":
      return "Verify live refund and dispute webhook delivery, then set STRIPE_LIVE_FINANCIAL_EVENTS_VERIFIED=true.";
    case "stripe_account":
      return "Complete Stripe platform account business details in live mode.";
    case "live_webhook_endpoint":
      return "Enable the live Stripe webhook endpoint at the production /api/webhook URL with every required financial event.";
    case "seller_connect":
      return "Confirm stored Stripe Connect seller accounts are submitted and payout-enabled, or remove stale seller rows.";
    case "stripe_api_access":
      return "Restore live Stripe API validation by staging valid live keys and checking Stripe account/webhook access.";
    default:
      return "Open /admin/live-payment-launch and clear this live payment launch check.";
  }
}

function withAction(check: LivePaymentCheck): LivePaymentNextAction {
  return {
    ...check,
    action: actionForLivePaymentCheck(check),
  };
}

function summarizeLivePaymentLaunch(params: {
  checks: LivePaymentCheck[];
  databaseApproved: boolean;
  runtimeSwitchEnabled: boolean;
  livePaymentsEnabled: boolean;
}): LivePaymentLaunchSummary {
  const approvalBlockers = params.checks
    .filter(
      (item) => item.status === "blocked" && !approvalExclusions.has(item.key),
    )
    .map(withAction);
  const launchLocks = params.checks
    .filter(
      (item) => item.status === "blocked" && approvalExclusions.has(item.key),
    )
    .map(withAction);
  const warnings = params.checks
    .filter((item) => item.status === "warning")
    .map(withAction);
  const passedCount = params.checks.filter(
    (item) => item.status === "passed",
  ).length;
  const blockedCount = params.checks.filter(
    (item) => item.status === "blocked",
  ).length;
  const runtimeSwitchEnabled = params.runtimeSwitchEnabled;
  const operatorSummary = params.livePaymentsEnabled
    ? "Live Checkout is enabled. Keep monitoring Stripe webhooks, reconciliation, refunds, disputes, seller payout holds, and emergency revocation."
    : approvalBlockers.length > 0
      ? `Live Checkout is locked with ${approvalBlockers.length} approval blocker(s). Clear these before recording database approval.`
      : !params.databaseApproved && !runtimeSwitchEnabled
        ? "Approval blockers are clear. Record the database approval when the operator is ready, then leave TCOS_LIVE_PAYMENTS_ENABLED off until the final go-live window."
        : !params.databaseApproved
          ? "Approval blockers are clear. Record the auditable database approval before live Checkout can open."
          : !runtimeSwitchEnabled
            ? "Database approval is current. TCOS_LIVE_PAYMENTS_ENABLED remains the final runtime lock before live Checkout opens."
            : "Live Checkout is locked by the launch gate state. Review database approval and runtime switch evidence before proceeding.";

  return {
    totalChecks: params.checks.length,
    passedCount,
    warningCount: warnings.length,
    blockedCount,
    approvalBlockingCount: approvalBlockers.length,
    launchLockCount: launchLocks.length,
    databaseApproved: params.databaseApproved,
    runtimeSwitchEnabled,
    operatorSummary,
    approvalBlockers,
    launchLocks,
    warnings,
    nextActions: [...approvalBlockers, ...launchLocks, ...warnings],
  };
}

export function getLivePaymentGateErrorDetail(error: {
  code?: string;
  message?: string;
}): string {
  const message = error.message || "Unknown Supabase error.";
  const missingGateTable =
    error.code === "42P01" ||
    /live_payment_launch_(gates|events)|schema cache|does not exist|relation .* not found/i.test(
      message,
    );

  if (missingGateTable) {
    return "Live payment approval tables are unavailable. Apply supabase/migrations/20260710185000_create_live_payment_launch_gate.sql before enabling live Checkout.";
  }

  return `Live payment approval could not be verified: ${message}`;
}

export async function getLivePaymentRuntimeGate(params: {
  stripeKey: string;
  storeId?: string;
  supabase?: SupabaseClient;
}) {
  if (params.stripeKey.startsWith("sk_test_")) {
    return { allowed: true, mode: "test" as const, reason: null };
  }

  if (!params.stripeKey.startsWith("sk_live_")) {
    return {
      allowed: false,
      mode: "unknown" as const,
      reason: "Stripe payment configuration is invalid.",
    };
  }

  if (process.env.TCOS_LIVE_PAYMENTS_ENABLED !== "true") {
    return {
      allowed: false,
      mode: "live" as const,
      reason: "Live payments are administratively locked.",
    };
  }

  const supabase =
    params.supabase || createSupabaseServerClient({ admin: true });
  const storeId = params.storeId || getActiveStoreId();
  const { data, error } = await supabase
    .from("live_payment_launch_gates")
    .select("gate_status,approval_version")
    .eq("store_id", storeId)
    .maybeSingle();

  const approved =
    !error &&
    data?.gate_status === "approved" &&
    data?.approval_version === LIVE_PAYMENT_APPROVAL_VERSION;

  if (!approved) {
    return {
      allowed: false,
      mode: "live" as const,
      reason: error
        ? getLivePaymentGateErrorDetail(error)
        : "Live payments require current administrator launch approval.",
    };
  }

  const { error: approvalEventsError } = await supabase
    .from("live_payment_launch_events")
    .select("id")
    .eq("store_id", storeId)
    .limit(1);

  if (approvalEventsError) {
    return {
      allowed: false,
      mode: "live" as const,
      reason: getLivePaymentGateErrorDetail(approvalEventsError),
    };
  }

  const dryRunShippingCleanup = await getDryRunShippingCleanupSummary({
    supabase,
    storeId,
  });

  if (dryRunShippingCleanup.error || dryRunShippingCleanup.total > 0) {
    return {
      allowed: false,
      mode: "live" as const,
      reason: dryRunShippingCleanup.error
        ? `Live payments are blocked because dry-run shipping cleanup could not be verified: ${dryRunShippingCleanup.error.message}`
        : `Live payments are blocked until dry-run shipping cleanup is complete. ${dryRunShippingCleanup.detail}`,
    };
  }

  return {
    allowed: true,
    mode: "live" as const,
    reason: null,
  };
}

export async function getStripePaymentRuntime(params?: {
  storeId?: string;
  supabase?: SupabaseClient;
}) {
  const stripeKey =
    process.env.TCOS_LIVE_PAYMENTS_ENABLED === "true"
      ? getStripeLiveSecretKey()
      : getStripeTestSecretKey();

  if (!stripeKey) {
    return {
      allowed: false,
      mode:
        process.env.TCOS_LIVE_PAYMENTS_ENABLED === "true"
          ? ("live" as const)
          : ("test" as const),
      reason: "The selected Stripe credential mode is not configured.",
      stripeKey: null,
    };
  }

  const gate = await getLivePaymentRuntimeGate({
    stripeKey,
    storeId: params?.storeId,
    supabase: params?.supabase,
  });
  return { ...gate, stripeKey };
}

export async function evaluateLivePaymentLaunch(params?: {
  supabase?: SupabaseClient;
  storeId?: string;
}): Promise<LivePaymentLaunchReport> {
  const supabase =
    params?.supabase || createSupabaseServerClient({ admin: true });
  const storeId = params?.storeId || getActiveStoreId();
  const mode = paymentMode();
  const storeSettings = await getStoreSettings(supabase, storeId);
  const origin = productionOrigin(storeSettings.primaryDomain);
  const checks: LivePaymentCheck[] = [];

  const [
    gateResult,
    approvalEventsResult,
    latestE2EResult,
    openMoneyResult,
    testOrdersResult,
    testProductsResult,
    sellerAccountsResult,
    dryRunShippingCleanup,
  ] =
    await Promise.all([
      supabase
        .from("live_payment_launch_gates")
        .select("gate_status,approval_version,approved_at,approved_by")
        .eq("store_id", storeId)
        .maybeSingle(),
      supabase
        .from("live_payment_launch_events")
        .select("id")
        .eq("store_id", storeId)
        .limit(1),
      supabase
        .from("payment_simulation_runs")
        .select("run_status,scenario_count,passed_count,failed_count,completed_at")
        .eq("store_id", storeId)
        .eq("run_mode", "checkout_e2e")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("stripe_reconciliation_items")
        .select("id", { count: "exact", head: true })
        .eq("store_id", storeId)
        .eq("item_status", "open"),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("store_id", storeId)
        .eq("is_test", true),
      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("store_id", storeId)
        .like("title", "[TCOS TEST]%"),
      supabase
        .from("seller_payout_accounts")
        .select("provider_account_id,onboarding_status,payouts_enabled,details_submitted,disabled_reason")
        .eq("store_id", storeId)
        .eq("provider", "stripe_connect"),
      getDryRunShippingCleanupSummary({ supabase, storeId }),
    ]);

  const gate = (gateResult.data || null) as GateRow | null;
  const databaseApproved =
    !gateResult.error &&
    gate?.gate_status === "approved" &&
    gate?.approval_version === LIVE_PAYMENT_APPROVAL_VERSION;
  const approvalDatabaseReady =
    !gateResult.error && !approvalEventsResult.error;
  checks.push(
    check(
      "database_approval",
      "Administrator Approval",
      databaseApproved ? "passed" : "blocked",
      databaseApproved
        ? `Approved by ${gate?.approved_by || "TCOS admin"} at ${gate?.approved_at || "an unknown time"}.`
        : gateResult.error
          ? getLivePaymentGateErrorDetail(gateResult.error)
          : approvalEventsResult.error
            ? getLivePaymentGateErrorDetail(approvalEventsResult.error)
          : "The auditable database launch approval is locked or stale.",
    ),
  );

  checks.push(
    check(
      "runtime_switch",
      "Environment Kill Switch",
      process.env.TCOS_LIVE_PAYMENTS_ENABLED === "true" ? "passed" : "blocked",
      process.env.TCOS_LIVE_PAYMENTS_ENABLED === "true"
        ? "TCOS_LIVE_PAYMENTS_ENABLED is true. Database revocation can still stop Checkout."
        : "TCOS_LIVE_PAYMENTS_ENABLED is not true, so live Checkout is hard-locked.",
    ),
  );

  checks.push(
    check(
      "stripe_key_mode",
      "Matching Live Stripe Keys",
      mode === "live" ? "passed" : "blocked",
      mode === "live"
        ? "Secret and publishable Stripe keys are both live-mode keys."
        : `Stripe key mode is ${mode}; live approval requires matching live keys.`,
    ),
  );

  checks.push(
    check(
      "production_origin",
      "HTTPS Production Origin",
      origin ? "passed" : "blocked",
      origin
        ? `The expected payment origin is ${origin}.`
        : "A valid HTTPS NEXT_PUBLIC_SITE_URL or primary store domain is required.",
    ),
  );

  const feeRate = Number(storeSettings.sellerCommissionRate || 0);
  checks.push(
    check(
      "platform_fee",
      "8% Platform Fee",
      Math.abs(feeRate - 0.08) < 0.000001 ? "passed" : "blocked",
      `The active store platform fee is ${(feeRate * 100).toFixed(2)}%.`,
    ),
  );

  const latestE2E = latestE2EResult.data;
  const e2ePassed =
    !latestE2EResult.error &&
    latestE2E?.run_status === "passed" &&
    Number(latestE2E?.scenario_count || 0) >= 8 &&
    Number(latestE2E?.failed_count || 0) === 0;
  checks.push(
    check(
      "checkout_e2e",
      "Full Checkout E2E",
      e2ePassed ? "passed" : "blocked",
      e2ePassed
        ? `${latestE2E.passed_count}/${latestE2E.scenario_count} scenarios passed at ${latestE2E.completed_at}.`
        : "The latest isolated checkout-to-refund run has not passed all required scenarios.",
    ),
  );

  const openMoney = safeCount(openMoneyResult.count);
  checks.push(
    check(
      "unmatched_money",
      "Unmatched Money Queue",
      !openMoneyResult.error && openMoney === 0 ? "passed" : "blocked",
      openMoneyResult.error
        ? `The unmatched money queue could not be checked: ${openMoneyResult.error.message}`
        : `${openMoney} reconciliation item(s) remain open.`,
    ),
  );

  const testOrders = safeCount(testOrdersResult.count);
  const testProducts = safeCount(testProductsResult.count);
  checks.push(
    check(
      "test_residue",
      "Test Fixture Isolation",
      !testOrdersResult.error && !testProductsResult.error && testOrders === 0 && testProducts === 0
        ? "passed"
        : "blocked",
      `${testOrders} test order(s) and ${testProducts} disposable product(s) remain.`,
    ),
  );

  checks.push(
    check(
      "dry_run_shipping_cleanup",
      "Dry-Run Shipping Cleanup",
      !dryRunShippingCleanup.error && dryRunShippingCleanup.total === 0
        ? "passed"
        : "blocked",
      dryRunShippingCleanup.error
        ? `Dry-run shipping cleanup could not be checked: ${dryRunShippingCleanup.error.message}`
        : dryRunShippingCleanup.detail,
    ),
  );

  checks.push(
    check(
      "monthly_subscription",
      "$5 Monthly Subscription",
      process.env.TCOS_MONTHLY_SUBSCRIPTION_ENABLED === "true" ? "blocked" : "passed",
      process.env.TCOS_MONTHLY_SUBSCRIPTION_ENABLED === "true"
        ? "The monthly subscription flag is enabled, contrary to the current TCOS launch decision."
        : "Monthly subscription billing is disabled; TCOS remains at the 8% transaction fee only.",
    ),
  );

  const webhookSecretConfigured = Boolean(getStripeLiveWebhookSecret());
  checks.push(
    check(
      "webhook_secret",
      "Live Webhook Signing Secret",
      mode === "live" && webhookSecretConfigured ? "passed" : "blocked",
      mode === "live" && webhookSecretConfigured
        ? "A webhook signing secret is configured for the live-key deployment."
        : "Live mode needs its own endpoint signing secret; test and live secrets are different.",
    ),
  );

  const financialEventsVerified =
    process.env.STRIPE_LIVE_FINANCIAL_EVENTS_VERIFIED === "true";
  checks.push(
    check(
      "financial_event_verification",
      "Live Refund And Dispute Verification",
      financialEventsVerified ? "passed" : "blocked",
      financialEventsVerified
        ? "Live refund and dispute event delivery is operator-verified."
        : "Set STRIPE_LIVE_FINANCIAL_EVENTS_VERIFIED=true only after verifying live endpoint delivery.",
    ),
  );

  const liveStripeKey = getStripeLiveSecretKey();
  if (mode === "live" && liveStripeKey) {
    try {
      const stripe = new Stripe(liveStripeKey);
      const [platformAccount, endpoints] = await Promise.all([
        stripe.accounts.retrieve(null),
        stripe.webhookEndpoints.list({ limit: 100 }),
      ]);
      checks.push(
        check(
          "stripe_account",
          "Stripe Platform Account",
          platformAccount.details_submitted ? "passed" : "blocked",
          platformAccount.details_submitted
            ? `Stripe platform account ${platformAccount.id} has submitted its business details.`
            : `Stripe platform account ${platformAccount.id} still requires business details.`,
        ),
      );

      const expectedWebhookUrl = origin ? `${origin}/api/webhook` : null;
      const endpoint = expectedWebhookUrl
        ? endpoints.data.find(
            (candidate) =>
              candidate.url === expectedWebhookUrl && candidate.status === "enabled",
          )
        : null;
      const enabledEvents = new Set(endpoint?.enabled_events || []);
      const eventCoverage =
        enabledEvents.has("*") ||
        REQUIRED_LIVE_WEBHOOK_EVENTS.every((event) => enabledEvents.has(event));
      checks.push(
        check(
          "live_webhook_endpoint",
          "Live Stripe Webhook Endpoint",
          endpoint && eventCoverage ? "passed" : "blocked",
          endpoint && eventCoverage
            ? `${expectedWebhookUrl} is enabled with all ${REQUIRED_LIVE_WEBHOOK_EVENTS.length} required events.`
            : `No enabled live endpoint at ${expectedWebhookUrl || "the production origin"} has the complete required event set.`,
        ),
      );

      const sellerRows = sellerAccountsResult.data || [];
      const connectedSellerIds = sellerRows
        .map((row) => row.provider_account_id)
        .filter((value): value is string => Boolean(value));
      const sellerChecks = await Promise.all(
        connectedSellerIds.slice(0, 100).map(async (accountId) => {
          try {
            const account = await stripe.accounts.retrieve(accountId);
            return account.details_submitted && account.payouts_enabled;
          } catch {
            return false;
          }
        }),
      );
      const sellersReady =
        !sellerAccountsResult.error && sellerChecks.every(Boolean);
      checks.push(
        check(
          "seller_connect",
          "Stripe Connect Sellers",
          sellersReady ? "passed" : "blocked",
          connectedSellerIds.length === 0
            ? "No connected seller requires live payout activation yet."
            : sellersReady
            ? `${connectedSellerIds.length} connected seller account(s) are live and payout-enabled.`
            : "One or more stored seller accounts are not valid, submitted, and payout-enabled in live mode.",
        ),
      );
    } catch (error: any) {
      checks.push(
        check(
          "stripe_api_access",
          "Live Stripe API Access",
          "blocked",
          `Live Stripe validation failed: ${String(error?.message || "unknown error").slice(0, 300)}`,
        ),
      );
    }
  } else {
    checks.push(
      check(
        "stripe_api_access",
        "Live Stripe API Access",
        "blocked",
        "Live API account, webhook, and connected-seller checks begin after matching live keys are configured.",
      ),
    );
  }

  const approvalReady = checks.every(
    (item) => item.status !== "blocked" || approvalExclusions.has(item.key),
  );
  const runtimeSwitchEnabled = process.env.TCOS_LIVE_PAYMENTS_ENABLED === "true";
  const livePaymentsEnabled =
    approvalReady &&
    databaseApproved &&
    runtimeSwitchEnabled;
  const summary = summarizeLivePaymentLaunch({
    checks,
    databaseApproved,
    runtimeSwitchEnabled,
    livePaymentsEnabled,
  });

  return {
    approvalVersion: LIVE_PAYMENT_APPROVAL_VERSION,
    generatedAt: new Date().toISOString(),
    paymentMode: mode,
    credentialDiagnostics: {
      liveSecretKeyRecognized: Boolean(getStripeLiveSecretKey()),
      liveSecretKeyShape: stripeCredentialShape(
        process.env.STRIPE_LIVE_SECRET_KEY,
        "sk_live_",
      ),
      livePublishableKeyRecognized: Boolean(getStripeLivePublishableKey()),
      livePublishableKeyShape: stripeCredentialShape(
        process.env.NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY,
        "pk_live_",
      ),
      liveWebhookSecretRecognized: Boolean(getStripeLiveWebhookSecret()),
      testSecretKeyRecognized: Boolean(getStripeTestSecretKey()),
      livePaymentsSwitchEnabled:
        process.env.TCOS_LIVE_PAYMENTS_ENABLED === "true",
      liveFinancialEventsVerified:
        process.env.STRIPE_LIVE_FINANCIAL_EVENTS_VERIFIED === "true",
    },
    approvalDatabaseReady,
    approvalReady,
    livePaymentsEnabled,
    summary,
    checks,
  };
}
