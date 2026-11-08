import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluateLivePaymentLaunch,
  getLivePaymentRuntimeGate,
} from "./live-payment-launch";
import {
  evaluateLiveShippingLaunch,
  getLiveShippingRuntimeGate,
} from "./live-shipping-launch";
import {
  buildShippingProviderSetupPacket,
  type ProviderSetupActionPlanStep,
} from "./shipping-provider-setup";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

export type LaunchGateDrillStatus = "passed" | "warning" | "failed";
export type LaunchGatePostureStatus = "ready" | "locked" | "blocked" | "review";

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
    approvalBlockingCount: number;
    launchLockCount: number;
    warningCount: number;
    operatorSummary: string;
    nextActions: string[];
  };
  shipping: {
    liveShippingEnabled: boolean;
    purchaseMode: string;
    standardEnvelopeEvidenceContractReady: boolean;
    purchaseAttemptAuditRunStatus: "passed" | "failed";
    purchaseAttemptAuditScenarioCount: number;
    purchaseAttemptAuditExpectedScenarioCount: number;
    purchaseAttemptAuditKeyCoverageStatus: "passed" | "failed";
    purchaseAttemptAuditMissingScenarioKeys: string[];
    purchaseAttemptAuditUnexpectedScenarioKeys: string[];
    providerSetupActionPlan: ProviderSetupActionPlanStep[];
  };
  posture: {
    payment: LaunchGatePosture;
    shipping: LaunchGatePosture;
  };
  sideEffectPolicy: LaunchGateSideEffectPolicy;
  checks: LaunchGateDrillCheck[];
};

export type LaunchGatePosture = {
  status: LaunchGatePostureStatus;
  label: string;
  detail: string;
  blockedChecks: string[];
  warningChecks: string[];
  nextActions: string[];
};

export type LaunchGateSideEffectPolicy = {
  assurance: string;
  allowedOperations: string[];
  forbiddenOperations: string[];
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

function checkLabels(
  checks: Array<{ label: string; status: "passed" | "warning" | "blocked" }>,
  status: "warning" | "blocked",
) {
  return checks
    .filter((check) => check.status === status)
    .map((check) => check.label);
}

function buildPaymentPosture(params: {
  approvalDatabaseReady: boolean;
  approvalReady: boolean;
  livePaymentsEnabled: boolean;
  paymentMode: string;
  blockedChecks: string[];
  warningChecks: string[];
}): LaunchGatePosture {
  if (!params.approvalDatabaseReady) {
    return {
      status: "blocked",
      label: "Payment Gate Missing Tables",
      detail:
        "Live payment runtime checks are fail-closed because the approval audit tables are not fully available.",
      blockedChecks: params.blockedChecks,
      warningChecks: params.warningChecks,
      nextActions: [
        "Apply the live-payment launch gate migration.",
        "Rerun the Launch Gate Drill and Live Payment Launch report.",
      ],
    };
  }

  if (params.approvalReady && params.livePaymentsEnabled) {
    return {
      status: "ready",
      label: "Live Payments Open",
      detail:
        "The live-payment runtime lock is open and the no-money drill matches the live-payment launch report.",
      blockedChecks: params.blockedChecks,
      warningChecks: params.warningChecks,
      nextActions: [
        "Keep Stripe webhook smoke, reconciliation, evidence, and dispute/refund checks green.",
        "Monitor new live orders and Stripe events from the payment launch page.",
      ],
    };
  }

  if (params.approvalReady) {
    return {
      status: "locked",
      label: "Payments Ready But Locked",
      detail:
        "The payment gate is ready for approval, but the live-payment environment switch is not open.",
      blockedChecks: params.blockedChecks,
      warningChecks: params.warningChecks,
      nextActions: [
        "Only enable the live-payment switch when intentionally accepting live Checkout.",
        "Rerun the no-money drill immediately after changing payment environment switches.",
      ],
    };
  }

  return {
    status: "blocked",
    label: "Payment Gate Blocked",
    detail:
      "The live-payment launch report still has required checks that must be cleared before live Checkout is safe.",
    blockedChecks: params.blockedChecks,
    warningChecks: params.warningChecks,
    nextActions: [
      "Open Live Payment Launch and clear every blocked check.",
      "Rerun payment simulations, webhook smoke, and reconciliation before approval.",
    ],
  };
}

function buildShippingPosture(params: {
  approvalDatabaseReady: boolean;
  approvalReady: boolean;
  liveShippingEnabled: boolean;
  purchaseMode: string;
  standardEnvelopeEvidenceContractReady: boolean;
  blockedChecks: string[];
  warningChecks: string[];
}): LaunchGatePosture {
  if (!params.approvalDatabaseReady) {
    return {
      status: "blocked",
      label: "Shipping Gate Missing Tables",
      detail:
        "Live shipping runtime checks are fail-closed because the approval audit tables are not fully available.",
      blockedChecks: params.blockedChecks,
      warningChecks: params.warningChecks,
      nextActions: [
        "Apply the live-shipping launch gate migration.",
        "Rerun the Launch Gate Drill and Live Shipping Launch report.",
      ],
    };
  }

  if (params.approvalReady && params.liveShippingEnabled && params.purchaseMode === "live") {
    return {
      status: "ready",
      label: "Live Shipping Open",
      detail:
        `The live-shipping runtime lock is open and the no-postage drill matches the live-shipping launch report. Standard Envelope evidence validator is ${params.standardEnvelopeEvidenceContractReady ? "ready" : "blocked"}.`,
      blockedChecks: params.blockedChecks,
      warningChecks: params.warningChecks,
      nextActions: [
        "Monitor provider quote, buy, void, Coverage, webhook, and reconciliation events.",
        "Keep the five-scenario provider purchase-attempt audit suite passing before any live provider purchase flow.",
        "Keep dry-run cleanup clear before releasing seller payouts.",
      ],
    };
  }

  if (params.purchaseMode === "dry_run" && !params.liveShippingEnabled) {
    return {
      status: "locked",
      label: "Shipping Safely Locked",
      detail:
        `Shipping is intentionally limited to dry-run planning and manual external label records. TCOS is not allowed to buy live postage. Standard Envelope evidence validator is ${params.standardEnvelopeEvidenceContractReady ? "ready" : "blocked"}.`,
      blockedChecks: params.blockedChecks,
      warningChecks: params.warningChecks,
      nextActions: [
        "Configure Standard Envelope, parcel-label, and Coverage provider credentials.",
        "Build and approve the live adapter quote/buy/void, Coverage purchase, webhook, and reconciliation workflow.",
        "Keep the provider purchase-attempt audit suite green while live postage remains locked.",
        "Keep TCOS_SHIPPING_PURCHASE_MODE=dry_run until those external-provider checks are complete.",
      ],
    };
  }

  return {
    status: "blocked",
    label: "Shipping Gate Blocked",
    detail:
      `Live shipping is not ready. Standard Envelope evidence validator is ${params.standardEnvelopeEvidenceContractReady ? "ready" : "blocked"}. The runtime should remain closed until provider setup, simulations, live requirements, and admin approval all pass.`,
    blockedChecks: params.blockedChecks,
    warningChecks: params.warningChecks,
    nextActions: [
      "Open Live Shipping Launch and clear every blocked check.",
      "Rerun the provider purchase-attempt audit suite and shipping simulation lab after clearing setup blockers.",
      "Do not enable live postage while any provider, simulation, Coverage, webhook, or admin approval blocker remains.",
    ],
  };
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
    shippingProviderSetup,
    paymentTestRuntime,
    paymentInvalidRuntime,
    paymentLiveRuntime,
    shippingRuntime,
  ] = await Promise.all([
    evaluateLivePaymentLaunch({ supabase, storeId }),
    evaluateLiveShippingLaunch({ supabase, storeId }),
    Promise.resolve(buildShippingProviderSetupPacket()),
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
  const paymentBlockedChecks = checkLabels(paymentReport.checks, "blocked");
  const paymentWarningChecks = checkLabels(paymentReport.checks, "warning");
  const shippingBlockedChecks = checkLabels(shippingReport.checks, "blocked");
  const shippingWarningChecks = checkLabels(shippingReport.checks, "warning");

  return {
    generatedAt: new Date().toISOString(),
    storeId,
    summary,
    payment: {
      livePaymentsEnabled: paymentReport.livePaymentsEnabled,
      paymentMode: paymentReport.paymentMode,
      approvalBlockingCount: paymentReport.summary.approvalBlockingCount,
      launchLockCount: paymentReport.summary.launchLockCount,
      warningCount: paymentReport.summary.warningCount,
      operatorSummary: paymentReport.summary.operatorSummary,
      nextActions: paymentReport.summary.nextActions.map(
        (item) => `${item.label}: ${item.action}`,
      ),
    },
    shipping: {
      liveShippingEnabled: shippingReport.liveShippingEnabled,
      purchaseMode: shippingReport.purchaseMode,
      standardEnvelopeEvidenceContractReady:
        shippingReport.standardEnvelopeEvidenceContractReady,
      purchaseAttemptAuditRunStatus:
        shippingReport.purchaseAttemptAuditSimulation.run_status,
      purchaseAttemptAuditScenarioCount:
        shippingReport.purchaseAttemptAuditSimulation.scenario_count,
      purchaseAttemptAuditExpectedScenarioCount:
        shippingReport.purchaseAttemptAuditSimulation.expected_scenario_count,
      purchaseAttemptAuditKeyCoverageStatus:
        shippingReport.purchaseAttemptAuditSimulation
          .scenario_key_coverage_status,
      purchaseAttemptAuditMissingScenarioKeys:
        shippingReport.purchaseAttemptAuditSimulation.missing_scenario_keys,
      purchaseAttemptAuditUnexpectedScenarioKeys:
        shippingReport.purchaseAttemptAuditSimulation.unexpected_scenario_keys,
      providerSetupActionPlan: shippingProviderSetup.actionPlan,
    },
    posture: {
      payment: buildPaymentPosture({
        approvalDatabaseReady: paymentReport.approvalDatabaseReady,
        approvalReady: paymentReport.approvalReady,
        livePaymentsEnabled: paymentReport.livePaymentsEnabled,
        paymentMode: paymentReport.paymentMode,
        blockedChecks: paymentBlockedChecks,
        warningChecks: paymentWarningChecks,
      }),
      shipping: buildShippingPosture({
        approvalDatabaseReady: shippingReport.approvalDatabaseReady,
        approvalReady: shippingReport.approvalReady,
        liveShippingEnabled: shippingReport.liveShippingEnabled,
        purchaseMode: shippingReport.purchaseMode,
        standardEnvelopeEvidenceContractReady:
          shippingReport.standardEnvelopeEvidenceContractReady,
        blockedChecks: shippingBlockedChecks,
        warningChecks: shippingWarningChecks,
      }),
    },
    sideEffectPolicy: {
      assurance:
        "This drill is a no-money/no-postage runtime check. It reads launch reports and runtime gates only.",
      allowedOperations: [
        "Read live-payment and live-shipping launch reports.",
        "Evaluate payment runtime gates with synthetic Stripe key strings.",
        "Evaluate the shipping runtime gate without a package, quote, label, or provider transaction.",
        "Return an admin report for operator review.",
      ],
      forbiddenOperations: [
        "Create Stripe Checkout Sessions, Customers, PaymentIntents, refunds, or disputes.",
        "Quote, buy, void, print, or record provider postage labels.",
        "Purchase seller Coverage or create external claim/policy records.",
        "Release seller payouts or mark orders shipped.",
      ],
    },
    checks,
  };
}
