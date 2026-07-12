import {
  getUnder20SellerProtection,
  getShippingCoverage,
  resolveShippingMethod,
  standardEnvelopeRateForEstimatedOunces,
} from "./shipping";
import {
  getShippingProviderAdapterProfile,
  purchaseShippingLabel,
} from "./shipping-provider-adapter";
import { buildShippingProviderSetupPacket } from "./shipping-provider-setup";
import { buildUnder20SellerProtectionClaimSummary } from "./under20-seller-protection-claims";

export const SHIPPING_SIMULATION_SUITE_VERSION = "2026-07-12.2";

export type ShippingSimulationScenario = {
  scenario_key: string;
  scenario_status: "passed" | "failed";
  detail: string;
  assertions: Record<string, unknown>;
};

export type LiveShippingApprovalReport = {
  approval_status: "ready_to_request_live_mode" | "blocked";
  detail: string;
  next_action: string;
  provider_setup_status: string;
  purchase_mode: string;
  simulation_status: "passed" | "failed";
  requirements_ready_count: number;
  requirements_count: number;
  blockers: string[];
};

function pass(condition: boolean) {
  return condition ? "passed" : "failed";
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function runShippingSimulationSuite() {
  const scenarios: ShippingSimulationScenario[] = [];
  const providerSetup = buildShippingProviderSetupPacket();

  const standardEnvelope = resolveShippingMethod({
    requestedMethod: "STANDARD_ENVELOPE",
    itemCount: 3,
    subtotal: 19.99,
  });
  const standardEnvelopeRate = standardEnvelopeRateForEstimatedOunces({
    estimatedOunces: 3,
    now: new Date("2026-07-10T12:00:00.000Z"),
  });
  const currentStandardEnvelopeRate = standardEnvelopeRateForEstimatedOunces({
    estimatedOunces: 3,
  });
  scenarios.push({
    scenario_key: "standard_envelope_under_20_and_3oz",
    scenario_status: pass(
      standardEnvelope.method === "STANDARD_ENVELOPE" &&
        money(standardEnvelopeRate) === 1.32,
    ),
    detail:
      "A raw-card order at $19.99 and 3 estimated oz stays on Standard Envelope at the expected $1.32 pre-July-12 rate.",
    assertions: {
      resolved_method: standardEnvelope.method,
      estimated_ounces: standardEnvelope.standardEnvelope.estimatedOunces,
      postage_rate: standardEnvelopeRate,
      eligible: standardEnvelope.standardEnvelope.eligible,
    },
  });

  const overTwenty = resolveShippingMethod({
    requestedMethod: "STANDARD_ENVELOPE",
    itemCount: 1,
    subtotal: 20.01,
  });
  scenarios.push({
    scenario_key: "standard_envelope_over_20_forces_ground_advantage",
    scenario_status: pass(
      overTwenty.method === "GROUND_ADVANTAGE" &&
        overTwenty.standardEnvelope.eligible === false,
    ),
    detail:
      "A card order over $20.00 is forced from Standard Envelope to Ground Advantage.",
    assertions: {
      requested_method: overTwenty.requestedMethod,
      resolved_method: overTwenty.method,
      reason: overTwenty.reason,
    },
  });

  const overThreeOunces = resolveShippingMethod({
    requestedMethod: "STANDARD_ENVELOPE",
    itemCount: 4,
    subtotal: 19,
  });
  scenarios.push({
    scenario_key: "standard_envelope_over_3oz_forces_ground_advantage",
    scenario_status: pass(
      overThreeOunces.method === "GROUND_ADVANTAGE" &&
        overThreeOunces.standardEnvelope.estimatedOunces === 4,
    ),
    detail:
      "A raw-card order estimated above 3 oz is forced from Standard Envelope to Ground Advantage.",
    assertions: {
      requested_method: overThreeOunces.requestedMethod,
      resolved_method: overThreeOunces.method,
      estimated_ounces: overThreeOunces.standardEnvelope.estimatedOunces,
      reason: overThreeOunces.reason,
    },
  });

  const standardEnvelopeCoverage = getShippingCoverage({
    method: "STANDARD_ENVELOPE",
    subtotal: 19.99,
  });
  const groundCoverage = getShippingCoverage({
    method: "GROUND_ADVANTAGE",
    subtotal: 20.01,
  });
  scenarios.push({
    scenario_key: "coverage_required_for_standard_and_ground",
    scenario_status: pass(
      standardEnvelopeCoverage.required &&
        groundCoverage.required &&
        standardEnvelopeCoverage.sellerProtected &&
        groundCoverage.sellerProtected,
    ),
    detail:
      "Seller protection coverage is required for both Standard Envelope and Ground Advantage shipments.",
    assertions: {
      standard_envelope: standardEnvelopeCoverage,
      ground_advantage: groundCoverage,
    },
  });

  const optedInProtection = getUnder20SellerProtection({
    method: "STANDARD_ENVELOPE",
    subtotal: 18.75,
    sellerOptedIn: true,
  });
  const optedInClaim = buildUnder20SellerProtectionClaimSummary([
    {
      id: "sim-ledger-protected",
      gross_item_amount: 18.75,
      shipping_allocated_amount: 1.07,
      metadata: {
        under_20_seller_protection: optedInProtection,
      },
    },
  ]);
  scenarios.push({
    scenario_key: "under_20_seller_protection_opted_in_item_only",
    scenario_status: pass(
      optedInProtection.eligible &&
        optedInProtection.feeAmount === 0.38 &&
        optedInClaim.reimbursableItemAmount === 18.75 &&
        optedInClaim.reimbursesShipping === false &&
        optedInClaim.shippingExcludedAmount === 1.07,
    ),
    detail:
      "An opted-in under-$20 Standard Envelope sale withholds 2%, reimburses protected item amount only, and excludes shipping.",
    assertions: {
      protection: optedInProtection,
      claim: optedInClaim,
    },
  });

  const notOptedInProtection = getUnder20SellerProtection({
    method: "STANDARD_ENVELOPE",
    subtotal: 18.75,
    sellerOptedIn: false,
  });
  const notOptedInClaim = buildUnder20SellerProtectionClaimSummary([
    {
      id: "sim-ledger-unprotected",
      gross_item_amount: 18.75,
      shipping_allocated_amount: 1.07,
      metadata: {
        under_20_seller_protection: notOptedInProtection,
      },
    },
  ]);
  scenarios.push({
    scenario_key: "under_20_seller_protection_not_opted_in_seller_liability",
    scenario_status: pass(
      !notOptedInProtection.eligible &&
        notOptedInProtection.feeAmount === 0 &&
        notOptedInClaim.reimbursableItemAmount === 0 &&
        notOptedInClaim.sellerOptedIn === false,
    ),
    detail:
      "A non-opted-in under-$20 Standard Envelope sale withholds no reserve, reimburses $0, and leaves refund liability with the seller.",
    assertions: {
      protection: notOptedInProtection,
      claim: notOptedInClaim,
    },
  });

  const standardEnvelopeProfile =
    getShippingProviderAdapterProfile("STANDARD_ENVELOPE");
  const groundAdapterProfile =
    getShippingProviderAdapterProfile("GROUND_ADVANTAGE");
  scenarios.push({
    scenario_key: "shipping_adapter_profiles_are_auditable",
    scenario_status: pass(
      standardEnvelopeProfile.adapterKey === "standard_envelope_imb" &&
        groundAdapterProfile.adapterKey === "usps_parcel_label" &&
        standardEnvelopeProfile.livePurchaseSupported === false &&
        groundAdapterProfile.manualPurchaseRequired === true &&
        standardEnvelopeProfile.coverageProvider.length > 0,
    ),
    detail:
      "Shipping adapter profiles expose provider, carrier, credential, Coverage, live-support, and manual-fallback state without calling a live provider.",
    assertions: {
      standard_envelope: standardEnvelopeProfile,
      ground_advantage: groundAdapterProfile,
    },
  });

  const standardEnvelopePurchase = await purchaseShippingLabel({
    orderId: 1001,
    labelId: "sim-standard-envelope",
    method: "STANDARD_ENVELOPE",
    carrier: null,
    subtotal: 19.99,
    shippingAmount: standardEnvelopeRate,
    itemCount: 3,
    standardEnvelopeEstimatedOunces: 3,
  });
  scenarios.push({
    scenario_key: "dry_run_standard_envelope_purchase",
    scenario_status: pass(
      standardEnvelopePurchase.mode === "dry_run" &&
        standardEnvelopePurchase.trackingNumber.startsWith("IMB-") &&
        standardEnvelopePurchase.coverageStatus === "covered" &&
        standardEnvelopePurchase.postageAmount ===
          money(currentStandardEnvelopeRate),
    ),
    detail:
      "The dry-run adapter simulates a Standard Envelope IMb, coverage policy, and current-rate postage without buying postage.",
    assertions: {
      mode: standardEnvelopePurchase.mode,
      provider: standardEnvelopePurchase.provider,
      tracking_number: standardEnvelopePurchase.trackingNumber,
      postage_amount: standardEnvelopePurchase.postageAmount,
      expected_current_postage_amount: money(currentStandardEnvelopeRate),
      coverage_policy_id: standardEnvelopePurchase.coveragePolicyId,
    },
  });

  const groundPurchase = await purchaseShippingLabel({
    orderId: 1002,
    labelId: "sim-ground-advantage",
    method: "GROUND_ADVANTAGE",
    carrier: null,
    subtotal: 20.01,
    shippingAmount: 6.99,
    itemCount: 1,
  });
  scenarios.push({
    scenario_key: "dry_run_ground_advantage_purchase",
    scenario_status: pass(
      groundPurchase.mode === "dry_run" &&
        groundPurchase.trackingNumber.startsWith("USPS-") &&
        groundPurchase.coverageStatus === "covered" &&
        groundPurchase.postageAmount === 6.99,
    ),
    detail:
      "The dry-run adapter simulates a Ground Advantage tracking number, coverage policy, and postage without buying postage.",
    assertions: {
      mode: groundPurchase.mode,
      provider: groundPurchase.provider,
      tracking_number: groundPurchase.trackingNumber,
      postage_amount: groundPurchase.postageAmount,
      coverage_policy_id: groundPurchase.coveragePolicyId,
    },
  });

  const failed = scenarios.filter(
    (scenario) => scenario.scenario_status === "failed",
  ).length;
  const runStatus = failed > 0 ? "failed" : "passed";
  const requirementBlockers = providerSetup.liveRequirements
    .filter((requirement) => requirement.status !== "ready")
    .map((requirement) => requirement.label);
  const blockers = Array.from(
    new Set([
      ...requirementBlockers,
      ...providerSetup.decision.blockers,
      ...(runStatus === "failed" ? ["shipping simulation suite failed"] : []),
    ]),
  );
  const readyToRequestLiveMode =
    runStatus === "passed" &&
    blockers.length === 0 &&
    !["needs_provider_setup", "live_blocked"].includes(
      providerSetup.decision.status,
    );
  const liveApproval: LiveShippingApprovalReport = {
    approval_status: readyToRequestLiveMode
      ? "ready_to_request_live_mode"
      : "blocked",
    detail: readyToRequestLiveMode
      ? "Shipping simulations passed and all live-shipping approval gates are ready. A controlled live-mode request can be reviewed."
      : "Live shipping remains blocked. TCOS may plan labels, run dry-run purchase simulations, and record real external labels manually, but it must not buy live postage.",
    next_action: readyToRequestLiveMode
      ? "Review the provider setup packet, save approval evidence, and only then consider TCOS_SHIPPING_PURCHASE_MODE=live."
      : "Clear the listed blockers in the Live Adapter Approval Checklist, rerun simulations, and keep TCOS_SHIPPING_PURCHASE_MODE=dry_run.",
    provider_setup_status: providerSetup.decision.status,
    purchase_mode: providerSetup.lanes[0]?.purchaseMode || "dry_run",
    simulation_status: runStatus,
    requirements_ready_count: providerSetup.liveRequirements.filter(
      (requirement) => requirement.status === "ready",
    ).length,
    requirements_count: providerSetup.liveRequirements.length,
    blockers,
  };

  return {
    suite_version: SHIPPING_SIMULATION_SUITE_VERSION,
    run_status: runStatus,
    scenario_count: scenarios.length,
    passed_count: scenarios.length - failed,
    failed_count: failed,
    live_approval: liveApproval,
    scenarios,
  };
}
