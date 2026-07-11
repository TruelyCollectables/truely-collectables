import {
  getShippingCoverage,
  resolveShippingMethod,
  standardEnvelopeRateForEstimatedOunces,
} from "./shipping";
import {
  getShippingProviderAdapterProfile,
  purchaseShippingLabel,
} from "./shipping-provider-adapter";

export const SHIPPING_SIMULATION_SUITE_VERSION = "2026-07-11.1";

export type ShippingSimulationScenario = {
  scenario_key: string;
  scenario_status: "passed" | "failed";
  detail: string;
  assertions: Record<string, unknown>;
};

function pass(condition: boolean) {
  return condition ? "passed" : "failed";
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function runShippingSimulationSuite() {
  const scenarios: ShippingSimulationScenario[] = [];

  const standardEnvelope = resolveShippingMethod({
    requestedMethod: "STANDARD_ENVELOPE",
    itemCount: 3,
    subtotal: 19.99,
  });
  const standardEnvelopeRate = standardEnvelopeRateForEstimatedOunces({
    estimatedOunces: 3,
    now: new Date("2026-07-10T12:00:00.000Z"),
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
        standardEnvelopePurchase.postageAmount === 1.32,
    ),
    detail:
      "The dry-run adapter simulates a Standard Envelope IMb, coverage policy, and postage without buying postage.",
    assertions: {
      mode: standardEnvelopePurchase.mode,
      provider: standardEnvelopePurchase.provider,
      tracking_number: standardEnvelopePurchase.trackingNumber,
      postage_amount: standardEnvelopePurchase.postageAmount,
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

  return {
    suite_version: SHIPPING_SIMULATION_SUITE_VERSION,
    run_status: failed > 0 ? "failed" : "passed",
    scenario_count: scenarios.length,
    passed_count: scenarios.length - failed,
    failed_count: failed,
    scenarios,
  };
}
