import fs from "node:fs";
import { evaluateLivePaymentLaunch } from "../src/lib/live-payment-launch";
import { evaluateLiveShippingLaunch } from "../src/lib/live-shipping-launch";
import { createSupabaseServerClient } from "../src/lib/supabase-server";
import { getActiveStoreId } from "../src/lib/stores";

const namesPath = process.env.TCOS_VERCEL_ENV_NAMES_PATH || ".codex-run/vercel-production-env-names.txt";
const outputPath = process.env.TCOS_RUNTIME_AUDIT_OUTPUT || ".codex-run/production-runtime-readiness.json";

const requiredNames = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SITE_URL",
  "ADMIN_PASSWORD",
  "ADMIN_SESSION_SECRET",
  "STRIPE_LIVE_SECRET_KEY",
  "NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY",
  "STRIPE_LIVE_WEBHOOK_SECRET",
  "STRIPE_LIVE_FINANCIAL_EVENTS_VERIFIED",
  "TCOS_LIVE_PAYMENTS_ENABLED",
  "OPENAI_API_KEY",
  "SERPAPI_API_KEY",
  "EBAY_CLIENT_ID",
  "EBAY_CLIENT_SECRET",
  "EBAY_ENVIRONMENT",
  "RESEND_API_KEY",
  "TCOS_SHIPPING_PURCHASE_MODE",
  "TCOS_LIVE_SHIPPING_ENABLED",
] as const;

type Check = { key: string; ok: boolean; detail: string };

function env(name: string) {
  return String(process.env[name] || "").trim();
}

function flag(name: string) {
  return env(name) === "true";
}

function exactNamePresent(output: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Z0-9_])${escaped}([^A-Z0-9_]|$)`, "m").test(output);
}

async function httpCheck(
  checks: Check[],
  key: string,
  url: string | URL,
  options: RequestInit,
  validate: (response: Response, payload: Record<string, unknown>) => boolean =
    (response, payload) => response.ok && !payload.error,
) {
  try {
    const response = await fetch(url, options);
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    checks.push({ key, ok: validate(response, payload), detail: `HTTP ${response.status}` });
  } catch (error) {
    checks.push({
      key,
      ok: false,
      detail: error instanceof Error ? error.name : "request failed",
    });
  }
}

function paymentState(report: Awaited<ReturnType<typeof evaluateLivePaymentLaunch>>) {
  if (report.livePaymentsEnabled) return "LIVE_MONEY_OPEN";
  if (!report.approvalDatabaseReady) return "BLOCKED_APPROVAL";
  if (report.summary.approvalBlockingCount > 0) return "BLOCKED_APPROVAL";
  if (!report.summary.databaseApproved) return "READY_FOR_DATABASE_APPROVAL";
  if (!report.summary.runtimeSwitchEnabled) return "READY_FOR_RUNTIME_SWITCH";
  return "BLOCKED_LAUNCH_GATE";
}

async function main() {
  fs.mkdirSync(".codex-run", { recursive: true });
  const nameOutput = fs.readFileSync(namesPath, "utf8");
  const configuredNames = requiredNames.filter((name) => exactNamePresent(nameOutput, name));
  const missingNames = requiredNames.filter((name) => !configuredNames.includes(name));

  const checks: Check[] = [];
  const add = (key: string, ok: unknown, detail: string) =>
    checks.push({ key, ok: Boolean(ok), detail });

  let siteHost = "invalid";
  try {
    siteHost = new URL(env("NEXT_PUBLIC_SITE_URL")).host;
  } catch {}

  add("site_url", siteHost === "truelycollectables.com", siteHost);
  add(
    "supabase_url",
    /^https:\/\/[^\s]+\.supabase\.co$/i.test(env("NEXT_PUBLIC_SUPABASE_URL")),
    "HTTPS Supabase project URL",
  );
  add("supabase_anon_key", env("NEXT_PUBLIC_SUPABASE_ANON_KEY").length >= 40, "configured");
  add("supabase_service_role", env("SUPABASE_SERVICE_ROLE_KEY").length >= 40, "configured");
  add("admin_password", env("ADMIN_PASSWORD").length >= 12, "minimum length satisfied");
  add("admin_session_secret", env("ADMIN_SESSION_SECRET").length >= 32, "minimum length satisfied");
  add("stripe_secret_shape", env("STRIPE_LIVE_SECRET_KEY").startsWith("sk_live_"), "live-shaped");
  add(
    "stripe_publishable_shape",
    env("NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY").startsWith("pk_live_"),
    "live-shaped",
  );
  add("stripe_webhook_shape", env("STRIPE_LIVE_WEBHOOK_SECRET").startsWith("whsec_"), "webhook-shaped");
  add(
    "stripe_financial_events_verified",
    flag("STRIPE_LIVE_FINANCIAL_EVENTS_VERIFIED"),
    String(flag("STRIPE_LIVE_FINANCIAL_EVENTS_VERIFIED")),
  );
  add("ebay_environment", env("EBAY_ENVIRONMENT") === "production", env("EBAY_ENVIRONMENT") || "missing");
  add("resend_key_shape", env("RESEND_API_KEY").startsWith("re_"), "API-key-shaped");
  add(
    "shipping_purchase_mode",
    ["dry_run", "live"].includes(env("TCOS_SHIPPING_PURCHASE_MODE")),
    env("TCOS_SHIPPING_PURCHASE_MODE") || "missing",
  );
  add(
    "live_shipping_switch_shape",
    ["true", "false"].includes(env("TCOS_LIVE_SHIPPING_ENABLED")),
    env("TCOS_LIVE_SHIPPING_ENABLED") || "missing",
  );
  add(
    "live_payment_switch_shape",
    ["true", "false"].includes(env("TCOS_LIVE_PAYMENTS_ENABLED")),
    env("TCOS_LIVE_PAYMENTS_ENABLED") || "missing",
  );

  await httpCheck(checks, "openai_auth", "https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${env("OPENAI_API_KEY")}` },
    signal: AbortSignal.timeout(30_000),
  });

  const serpUrl = new URL("https://serpapi.com/search.json");
  serpUrl.searchParams.set("engine", "ebay");
  serpUrl.searchParams.set("ebay_domain", "ebay.com");
  serpUrl.searchParams.set("_nkw", "sports card");
  serpUrl.searchParams.set("_ipg", "1");
  serpUrl.searchParams.set("api_key", env("SERPAPI_API_KEY"));
  await httpCheck(checks, "serpapi_auth", serpUrl, {
    signal: AbortSignal.timeout(45_000),
  });

  await httpCheck(checks, "stripe_auth", "https://api.stripe.com/v1/balance", {
    headers: {
      Authorization: `Basic ${Buffer.from(`${env("STRIPE_LIVE_SECRET_KEY")}:`).toString("base64")}`,
    },
    signal: AbortSignal.timeout(30_000),
  });

  await httpCheck(
    checks,
    "ebay_auth",
    "https://api.ebay.com/identity/v1/oauth2/token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${env("EBAY_CLIENT_ID")}:${env("EBAY_CLIENT_SECRET")}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "https://api.ebay.com/oauth/api_scope",
      }),
      signal: AbortSignal.timeout(30_000),
    },
    (response, payload) => response.ok && Boolean(payload.access_token),
  );

  await httpCheck(checks, "resend_auth", "https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}` },
    signal: AbortSignal.timeout(30_000),
  });

  let money: Record<string, unknown>;
  let shipping: Record<string, unknown>;
  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const report = await evaluateLivePaymentLaunch({ supabase, storeId });
    money = {
      state: paymentState(report),
      approvalDatabaseReady: report.approvalDatabaseReady,
      databaseApproved: report.summary.databaseApproved,
      runtimeSwitchEnabled: report.summary.runtimeSwitchEnabled,
      liveCheckout: report.livePaymentsEnabled ? "OPEN" : "LOCKED",
      approvalBlockerCount: report.summary.approvalBlockingCount,
      launchLockCount: report.summary.launchLockCount,
      warningCount: report.summary.warningCount,
      blockers: report.summary.approvalBlockers.map((item) => ({
        key: item.key,
        label: item.label,
        detail: item.detail,
        action: item.action,
      })),
    };
  } catch (error) {
    money = {
      state: "BLOCKED_UNEVALUATED",
      error: error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 220) : "unknown",
    };
  }

  try {
    const report = await evaluateLiveShippingLaunch();
    const blocked = report.checks.filter((item) => item.status === "blocked");
    const warnings = report.checks.filter((item) => item.status === "warning");
    shipping = {
      purchaseMode: report.purchaseMode,
      approvalDatabaseReady: report.approvalDatabaseReady,
      approvalReady: report.approvalReady,
      liveShippingEnabled: report.liveShippingEnabled,
      standardEnvelopeEvidenceContractReady: report.standardEnvelopeEvidenceContractReady,
      blockedCount: blocked.length,
      warningCount: warnings.length,
      blockers: blocked.map((item) => ({ key: item.key, label: item.label, detail: item.detail })),
      warnings: warnings.map((item) => ({ key: item.key, label: item.label, detail: item.detail })),
      manualFulfillmentAllowed: report.purchaseMode === "dry_run",
    };
  } catch (error) {
    shipping = {
      purchaseMode: env("TCOS_SHIPPING_PURCHASE_MODE") || "unknown",
      manualFulfillmentAllowed: env("TCOS_SHIPPING_PURCHASE_MODE") === "dry_run",
      error: error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 220) : "unknown",
    };
  }

  const failedChecks = checks.filter((item) => !item.ok);
  const paymentReady = ["READY_FOR_RUNTIME_SWITCH", "LIVE_MONEY_OPEN"].includes(
    String(money.state || ""),
  );
  const shippingReady =
    shipping.purchaseMode === "dry_run" ||
    (shipping.purchaseMode === "live" &&
      shipping.approvalReady === true &&
      shipping.liveShippingEnabled === true);

  const blockers: string[] = [];
  if (missingNames.length) blockers.push(`missing Production names: ${missingNames.join(", ")}`);
  if (failedChecks.length) blockers.push(`provider/value checks failed: ${failedChecks.map((item) => item.key).join(", ")}`);
  if (!paymentReady) blockers.push(`live-payment state is ${String(money.state || "unknown")}`);
  if (!shippingReady) blockers.push("shipping is neither safe dry-run/manual fulfillment nor approved live purchase mode");

  const result = {
    schema: "tcos.productionRuntimeReadOnlyAudit.v2",
    generatedAt: new Date().toISOString(),
    readyForOneControlledDeployment: blockers.length === 0,
    blockers,
    environmentNames: {
      requiredCount: requiredNames.length,
      configuredCount: configuredNames.length,
      missing: missingNames,
    },
    providerAndValueChecks: checks,
    failedProviderAndValueChecks: failedChecks.map((item) => item.key),
    runtimeSwitches: {
      livePaymentsEnabled: flag("TCOS_LIVE_PAYMENTS_ENABLED"),
      shippingPurchaseMode: env("TCOS_SHIPPING_PURCHASE_MODE"),
      liveShippingEnabled: flag("TCOS_LIVE_SHIPPING_ENABLED"),
    },
    payment: money,
    shipping,
    requiredPostDeployAction:
      "Run npm run smoke:production against https://truelycollectables.com and ship only if it passes.",
    readOnlyGuarantee:
      "No deployment, alias change, environment mutation, launch approval, Checkout, payment, refund, payout, label, postage purchase, email send, or inventory mutation was performed.",
    secretValuesPrinted: false,
    deploymentStarted: false,
  };

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n");
  console.log(`ready_for_one_controlled_deployment=${result.readyForOneControlledDeployment}`);
  console.log(`configured_production_names=${configuredNames.length}/${requiredNames.length}`);
  console.log(`live_money_state=${String(money.state || "unknown")}`);
  console.log(`shipping_purchase_mode=${String(shipping.purchaseMode || "unknown")}`);
  console.log(`blockers=${blockers.join(" | ") || "none"}`);
  if (blockers.length) process.exitCode = 1;
}

main().catch((error) => {
  fs.mkdirSync(".codex-run", { recursive: true });
  const message = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 220) : "unknown";
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        schema: "tcos.productionRuntimeReadOnlyAudit.v2",
        generatedAt: new Date().toISOString(),
        readyForOneControlledDeployment: false,
        blockers: [`audit execution failed: ${message}`],
        readOnlyGuarantee:
          "No deployment, alias change, environment mutation, launch approval, Checkout, payment, refund, payout, label, postage purchase, email send, or inventory mutation was performed.",
        secretValuesPrinted: false,
        deploymentStarted: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.error(message);
  process.exitCode = 1;
});
