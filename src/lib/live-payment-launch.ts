import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "./supabase-server";
import { getStoreSettings } from "./store-settings";
import { getActiveStoreId } from "./stores";
import {
  getStripeLivePublishableKey,
  getStripeLiveSecretKey,
  getStripeLiveWebhookSecret,
  getStripeTestSecretKey,
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

export type LivePaymentLaunchReport = {
  approvalVersion: string;
  generatedAt: string;
  paymentMode: "live" | "test" | "mixed" | "missing";
  approvalReady: boolean;
  livePaymentsEnabled: boolean;
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

  return {
    allowed: approved,
    mode: "live" as const,
    reason: approved
      ? null
      : "Live payments require current administrator launch approval.",
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

  const [gateResult, latestE2EResult, openMoneyResult, testOrdersResult, testProductsResult, sellerAccountsResult] =
    await Promise.all([
      supabase
        .from("live_payment_launch_gates")
        .select("gate_status,approval_version,approved_at,approved_by")
        .eq("store_id", storeId)
        .maybeSingle(),
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
    ]);

  const gate = (gateResult.data || null) as GateRow | null;
  const databaseApproved =
    !gateResult.error &&
    gate?.gate_status === "approved" &&
    gate?.approval_version === LIVE_PAYMENT_APPROVAL_VERSION;
  checks.push(
    check(
      "database_approval",
      "Administrator Approval",
      databaseApproved ? "passed" : "blocked",
      databaseApproved
        ? `Approved by ${gate?.approved_by || "TCOS admin"} at ${gate?.approved_at || "an unknown time"}.`
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

  const approvalExclusions = new Set(["database_approval", "runtime_switch"]);
  const approvalReady = checks.every(
    (item) => item.status !== "blocked" || approvalExclusions.has(item.key),
  );
  const livePaymentsEnabled =
    approvalReady &&
    databaseApproved &&
    process.env.TCOS_LIVE_PAYMENTS_ENABLED === "true";

  return {
    approvalVersion: LIVE_PAYMENT_APPROVAL_VERSION,
    generatedAt: new Date().toISOString(),
    paymentMode: mode,
    approvalReady,
    livePaymentsEnabled,
    checks,
  };
}
