import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluateLivePaymentLaunch,
  getLivePaymentRuntimeGate,
} from "./live-payment-launch";
import {
  evaluateLiveShippingLaunch,
  getLiveShippingRuntimeGate,
} from "./live-shipping-launch";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

export type LaunchGateDrillStatus = "passed" | "warning" | "failed";

export type LaunchGateDrillCheck = {
  key: string;
  label: string;
  status: LaunchGateDrillStatus;
  detail: string;
};

export type LaunchGateDrillReport = {
  generatedAt: string;
  storeId: string;
  summary: {
    passed: number;
    warning: number;
    failed: number;
  };
  payment: {
    livePaymentsEnabled: boolean;
    paymentMode: string;
  };
  shipping: {
    liveShippingEnabled: boolean;
    purchaseMode: string;
  };
  checks: LaunchGateDrillCheck[];
};

function drillCheck(
  key: string,
  label: string,
  status: LaunchGateDrillStatus,
  detail: string,
): LaunchGateDrillCheck {
  return { key, label, status, detail };
}

function runtimeDetail(result: {
  allowed: boolean;
  mode: string;
  reason: string | null;
}) {
  return result.allowed
    ? `Runtime allowed in ${result.mode} mode.`
    : `Runtime blocked in ${result.mode} mode: ${result.reason || "no reason recorded"}`;
}

export async function runLaunchGateDrill(params?: {
  supabase?: SupabaseClient;
  storeId?: string;
}): Promise<LaunchGateDrillReport> {
  const supabase =
    params?.supabase || createSupabaseServerClient({ admin: true });
  const storeId = params?.storeId || getActiveStoreId();

  const [
    paymentReport,
    shippingReport,
    paymentTestRuntime,
    paymentInvalidRuntime,
    paymentLiveRuntime,
    shippingRuntime,
  ] = await Promise.all([
    evaluateLivePaymentLaunch({ supabase, storeId }),
    evaluateLiveShippingLaunch({ supabase, storeId }),
    getLivePaymentRuntimeGate({
      stripeKey: "sk_test_tcos_gate_drill_no_charge",
      supabase,
      storeId,
    }),
    getLivePaymentRuntimeGate({
      stripeKey: "not_a_stripe_secret",
      supabase,
      storeId,
    }),
    getLivePaymentRuntimeGate({
      stripeKey: "sk_live_tcos_gate_drill_no_charge",
      supabase,
      storeId,
    }),
    getLiveShippingRuntimeGate({ supabase, storeId }),
  ]);

  const paymentLiveMatchesReport =
    paymentLiveRuntime.allowed === paymentReport.livePaymentsEnabled;
  const shippingDryRunSafe =
    shippingReport.purchaseMode === "dry_run" &&
    shippingRuntime.allowed &&
    shippingRuntime.mode === "dry_run";
  const shippingLiveMatchesReport =
    shippingReport.purchaseMode === "live" &&
    shippingRuntime.allowed === shippingReport.liveShippingEnabled;

  const checks: LaunchGateDrillCheck[] = [
    drillCheck(
      "payment_test_mode_bypass",
      "Payment Test Mode Bypass",
      paymentTestRuntime.allowed && paymentTestRuntime.mode === "test"
        ? "passed"
        : "failed",
      `${runtimeDetail(paymentTestRuntime)} Test-mode Checkout should stay usable for simulations without touching live money.`,
    ),
    drillCheck(
      "payment_invalid_key_blocks",
      "Payment Invalid Key Blocks",
      !paymentInvalidRuntime.allowed && paymentInvalidRuntime.mode === "unknown"
        ? "passed"
        : "failed",
      `${runtimeDetail(paymentInvalidRuntime)} Invalid Stripe secrets must fail closed before any Checkout work.`,
    ),
    drillCheck(
      "payment_live_runtime_consistency",
      "Payment Live Runtime Consistency",
      paymentLiveMatchesReport ? "passed" : "failed",
      `${runtimeDetail(paymentLiveRuntime)} The live runtime gate ${
        paymentLiveMatchesReport ? "matches" : "does not match"
      } the live-payment report state.`,
    ),
    drillCheck(
      "payment_no_money_side_effect",
      "Payment Drill Side Effects",
      "passed",
      "The drill uses synthetic key strings and does not create Checkout Sessions, Customers, PaymentIntents, refunds, or disputes.",
    ),
    drillCheck(
      "shipping_runtime_consistency",
      "Shipping Runtime Consistency",
      shippingDryRunSafe || shippingLiveMatchesReport ? "passed" : "failed",
      `${runtimeDetail(shippingRuntime)} The shipping runtime gate ${
        shippingDryRunSafe
          ? "is safely limited to dry-run mode"
          : shippingLiveMatchesReport
            ? "matches the live-shipping report state"
            : "does not match the live-shipping report state"
      }.`,
    ),
    drillCheck(
      "shipping_no_postage_side_effect",
      "Shipping Drill Side Effects",
      "passed",
      "The drill calls only the runtime gate and report evaluators. It does not quote, buy, void, or record a provider label.",
    ),
  ];

  if (!paymentReport.approvalDatabaseReady) {
    checks.push(
      drillCheck(
        "payment_approval_tables",
        "Payment Approval Tables",
        "failed",
        "The payment drill could run, but approval tables are not fully available. Apply the live-payment launch gate migration.",
      ),
    );
  }

  if (!shippingReport.approvalDatabaseReady) {
    checks.push(
      drillCheck(
        "shipping_approval_tables",
        "Shipping Approval Tables",
        "failed",
        "The shipping drill could run, but approval tables are not fully available. Apply the live-shipping launch gate migration.",
      ),
    );
  }

  const summary = {
    passed: checks.filter((check) => check.status === "passed").length,
    warning: checks.filter((check) => check.status === "warning").length,
    failed: checks.filter((check) => check.status === "failed").length,
  };

  return {
    generatedAt: new Date().toISOString(),
    storeId,
    summary,
    payment: {
      livePaymentsEnabled: paymentReport.livePaymentsEnabled,
      paymentMode: paymentReport.paymentMode,
    },
    shipping: {
      liveShippingEnabled: shippingReport.liveShippingEnabled,
      purchaseMode: shippingReport.purchaseMode,
    },
    checks,
  };
}
