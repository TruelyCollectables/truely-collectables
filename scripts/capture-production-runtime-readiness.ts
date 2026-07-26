import fs from "node:fs";
import path from "node:path";
import { getClientIdentity } from "../src/lib/client-identity";
import { evaluateLivePaymentLaunch } from "../src/lib/live-payment-launch";
import { evaluateLiveShippingLaunch } from "../src/lib/live-shipping-launch";
import { buildShippingProviderSetupPacket } from "../src/lib/shipping-provider-setup";
import { getStoreSettings } from "../src/lib/store-settings";
import { getActiveStoreId } from "../src/lib/stores";
import { createSupabaseServerClient } from "../src/lib/supabase-server";

const outputPath = path.resolve(
  process.cwd(),
  process.env.TCOS_RUNTIME_AUDIT_OUTPUT || "production-runtime-readiness.json",
);

function configured(value: string | undefined) {
  return Boolean(value?.trim());
}

function prefix(value: string | undefined, expected: string) {
  return Boolean(value?.trim().startsWith(expected));
}

function redact(value: unknown) {
  return String(value)
    .replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_=-]{8,}\b/g, "[redacted-stripe-secret]")
    .replace(/\bpk_(?:live|test)_[A-Za-z0-9_=-]{8,}\b/g, "[redacted-stripe-publishable]")
    .replace(/\bwhsec_[A-Za-z0-9_=-]{8,}\b/g, "[redacted-stripe-webhook]")
    .replace(/\bre_[A-Za-z0-9_=-]{8,}\b/g, "[redacted-resend-key]")
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "[redacted-jwt]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, "[redacted-auth-header]");
}

function check(label: string, ready: boolean, detail: string, blocker = true) {
  return {
    label,
    status: ready ? ("ready" as const) : blocker ? ("blocked" as const) : ("warning" as const),
    detail,
  };
}

async function main() {
  const environmentChecks = [
    check(
      "HTTPS production site URL",
      Boolean(process.env.NEXT_PUBLIC_SITE_URL?.trim().startsWith("https://")),
      "NEXT_PUBLIC_SITE_URL must be the final HTTPS production origin.",
    ),
    check("Supabase URL", configured(process.env.NEXT_PUBLIC_SUPABASE_URL), "NEXT_PUBLIC_SUPABASE_URL is required."),
    check("Supabase anon key", configured(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY), "NEXT_PUBLIC_SUPABASE_ANON_KEY is required."),
    check("Supabase service role", configured(process.env.SUPABASE_SERVICE_ROLE_KEY), "SUPABASE_SERVICE_ROLE_KEY is required for privileged launch checks."),
    check("Admin password", configured(process.env.ADMIN_PASSWORD), "ADMIN_PASSWORD is required."),
    check("Admin session secret", configured(process.env.ADMIN_SESSION_SECRET), "ADMIN_SESSION_SECRET must be independently configured."),
    check(
      "Identity intelligence required",
      process.env.IP_INTELLIGENCE_REQUIRED === "true",
      "IP_INTELLIGENCE_REQUIRED must be true for live Checkout.",
    ),
    check("Identity intelligence URL", configured(process.env.IP_INTELLIGENCE_API_URL), "IP_INTELLIGENCE_API_URL is required."),
    check("Dedicated Stripe live secret", prefix(process.env.STRIPE_LIVE_SECRET_KEY, "sk_live_"), "STRIPE_LIVE_SECRET_KEY must be a dedicated live secret."),
    check(
      "Dedicated Stripe live publishable key",
      prefix(process.env.NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY, "pk_live_"),
      "NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY must be a dedicated live publishable key.",
    ),
    check("Dedicated Stripe live webhook secret", prefix(process.env.STRIPE_LIVE_WEBHOOK_SECRET, "whsec_"), "STRIPE_LIVE_WEBHOOK_SECRET is required."),
    check(
      "Stripe financial events verified",
      process.env.STRIPE_LIVE_FINANCIAL_EVENTS_VERIFIED === "true",
      "STRIPE_LIVE_FINANCIAL_EVENTS_VERIFIED must be true only after live refund/dispute delivery is verified.",
    ),
    check(
      "Live payment switch recognized",
      ["true", "false"].includes(process.env.TCOS_LIVE_PAYMENTS_ENABLED || ""),
      "TCOS_LIVE_PAYMENTS_ENABLED must be explicitly true or false.",
    ),
    check("Cron secret", (process.env.CRON_SECRET?.trim().length || 0) >= 16, "CRON_SECRET must contain at least 16 characters."),
    check("Resend email provider", configured(process.env.RESEND_API_KEY), "RESEND_API_KEY is needed for order and evidence delivery.", false),
    check(
      "eBay production credentials",
      configured(process.env.EBAY_CLIENT_ID) &&
        configured(process.env.EBAY_CLIENT_SECRET) &&
        process.env.EBAY_ENVIRONMENT === "production",
      "EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, and EBAY_ENVIRONMENT=production are needed for live inventory synchronization.",
      false,
    ),
  ];

  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const [storeSettings, payment, shipping, rateLimitCapability, identity] = await Promise.all([
    getStoreSettings(supabase, storeId),
    evaluateLivePaymentLaunch({ supabase, storeId }),
    evaluateLiveShippingLaunch({ supabase, storeId }),
    supabase
      .from("public_endpoint_rate_limit_events")
      .select("id")
      .eq("store_id", storeId)
      .limit(1),
    getClientIdentity(
      new Request("https://truelycollectables.com/runtime-readiness", {
        headers: {
          "x-forwarded-for": "8.8.8.8",
          "user-agent": "tcos-production-runtime-readiness-audit",
        },
      }),
    ),
  ]);

  const providerSetup = buildShippingProviderSetupPacket();
  const identityProviderReachable = ![
    "ip_intelligence_not_configured",
  ].includes(identity.blockReason || "") &&
    !(identity.blockReason || "").startsWith("ip_intelligence_unavailable_") &&
    identity.risk !== "unchecked";
  const rateLimitTableReady = !rateLimitCapability.error;
  const evidenceEmailReady = configured(storeSettings.evidenceEmail || undefined);
  const ebaySyncReady =
    storeSettings.ebaySyncEnabled === true &&
    storeSettings.ebayEnvironment === "production" &&
    configured(process.env.EBAY_CLIENT_ID) &&
    configured(process.env.EBAY_CLIENT_SECRET);
  const environmentBlockers = environmentChecks.filter((item) => item.status === "blocked");
  const paymentApprovalBlockers = payment.summary.approvalBlockers;
  const paymentReadyForDatabaseApproval =
    payment.approvalDatabaseReady &&
    paymentApprovalBlockers.length === 0 &&
    !payment.summary.databaseApproved;
  const paymentReadyForRuntimeSwitch =
    payment.approvalDatabaseReady &&
    paymentApprovalBlockers.length === 0 &&
    payment.summary.databaseApproved &&
    !payment.summary.runtimeSwitchEnabled;
  const livePaymentsOpen = payment.livePaymentsEnabled;
  const shippingSafeForManualFulfillment =
    shipping.purchaseMode === "dry_run" &&
    process.env.TCOS_LIVE_SHIPPING_ENABLED !== "true";
  const readyForFinalLaunchWindow =
    environmentBlockers.length === 0 &&
    identityProviderReachable &&
    rateLimitTableReady &&
    (paymentReadyForRuntimeSwitch || livePaymentsOpen);

  const payload = {
    schema: "tcos.productionRuntimeReadiness.v1",
    generatedAt: new Date().toISOString(),
    storeId,
    readyForFinalLaunchWindow,
    launchState: livePaymentsOpen
      ? "LIVE_MONEY_OPEN"
      : paymentReadyForRuntimeSwitch
        ? "READY_FOR_RUNTIME_SWITCH"
        : paymentReadyForDatabaseApproval
          ? "READY_FOR_DATABASE_APPROVAL"
          : "BLOCKED",
    environment: {
      checks: environmentChecks,
      blockedCount: environmentBlockers.length,
      warningCount: environmentChecks.filter((item) => item.status === "warning").length,
    },
    identityIntelligence: {
      providerReachable: identityProviderReachable,
      resultRisk: identity.risk,
      resultBlocked: identity.blocked,
      resultReason: identity.blockReason,
      note:
        "The audit uses a fixed public test IP only to verify provider response. A blocked result can be valid when the provider classifies that IP as hosting or proxy infrastructure.",
    },
    rateLimitSecurity: {
      tableReady: rateLimitTableReady,
      error: rateLimitCapability.error
        ? redact(rateLimitCapability.error.message)
        : null,
      privilegeVerification:
        "Table availability is verified through the service role. Apply the dedicated privilege-hardening migration to revoke anon/authenticated access; REST cannot independently enumerate PostgreSQL grants.",
    },
    payments: {
      paymentMode: payment.paymentMode,
      approvalDatabaseReady: payment.approvalDatabaseReady,
      databaseApproved: payment.summary.databaseApproved,
      runtimeSwitchEnabled: payment.summary.runtimeSwitchEnabled,
      livePaymentsEnabled: payment.livePaymentsEnabled,
      approvalBlockingCount: payment.summary.approvalBlockingCount,
      launchLockCount: payment.summary.launchLockCount,
      warningCount: payment.summary.warningCount,
      approvalBlockers: payment.summary.approvalBlockers.map((item) => ({
        key: item.key,
        label: item.label,
        detail: redact(item.detail),
        action: item.action,
      })),
      launchLocks: payment.summary.launchLocks.map((item) => ({
        key: item.key,
        label: item.label,
        detail: redact(item.detail),
        action: item.action,
      })),
      readyForDatabaseApproval: paymentReadyForDatabaseApproval,
      readyForRuntimeSwitch: paymentReadyForRuntimeSwitch,
    },
    shipping: {
      purchaseMode: shipping.purchaseMode,
      liveShippingEnabled: shipping.liveShippingEnabled,
      approvalDatabaseReady: shipping.approvalDatabaseReady,
      approvalReady: shipping.approvalReady,
      safeForManualFulfillment: shippingSafeForManualFulfillment,
      providerDecision: providerSetup.decision.status,
      providerSummary: providerSetup.decision.summary,
      blockedChecks: shipping.checks
        .filter((item) => item.status === "blocked")
        .map((item) => ({ key: item.key, label: item.label, detail: redact(item.detail) })),
    },
    operations: {
      evidenceEmailConfigured: evidenceEmailReady,
      evidenceEmail: evidenceEmailReady ? storeSettings.evidenceEmail : null,
      resendConfigured: configured(process.env.RESEND_API_KEY),
      ebaySyncReady,
      ebaySyncEnabled: storeSettings.ebaySyncEnabled,
      ebayEnvironment: storeSettings.ebayEnvironment,
    },
    next: readyForFinalLaunchWindow
      ? "Production runtime is ready for the controlled final launch window. Keep switches locked until database approval, final deployment, and smoke testing are executed in order."
      : paymentReadyForDatabaseApproval
        ? "Record the auditable live-payment database approval after reviewing this evidence, then rerun the Production runtime audit."
        : "Clear every reported environment, identity, rate-limit, and live-payment approval blocker before deployment.",
    readOnlyGuarantee:
      "This audit reads Vercel-injected environment values in memory and performs read-only Supabase, Stripe, shipping, and identity-provider checks. It does not print secret values, deploy, change aliases, mutate environment variables, write database rows, approve launch, create Checkout, buy postage, issue refunds, release payouts, or change runtime switches.",
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  console.log(
    `Production runtime readiness audit completed: ${payload.launchState}. Evidence written without secret values.`,
  );

  if (!readyForFinalLaunchWindow) process.exitCode = 1;
}

main().catch((error) => {
  const payload = {
    schema: "tcos.productionRuntimeReadiness.v1",
    generatedAt: new Date().toISOString(),
    readyForFinalLaunchWindow: false,
    launchState: "BLOCKED_UNEVALUATED",
    error: redact(error instanceof Error ? error.message : error),
    next: "Restore Production runtime access and rerun the read-only audit.",
    readOnlyGuarantee:
      "No deployment, alias change, environment mutation, database write, payment action, postage purchase, approval, or runtime-switch change was attempted.",
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  console.error("Production runtime readiness audit could not complete.");
  process.exitCode = 1;
});
