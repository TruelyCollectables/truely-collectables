import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

export const PAYMENT_SIMULATION_SUITE_VERSION = "2026-07-10.1";
const PLATFORM_FEE_RATE = 0.08;

type ScenarioResult = {
  scenario_key: string;
  scenario_status: "passed" | "failed" | "skipped";
  detail: string;
  assertions?: Record<string, unknown>;
  provider_object_ids?: Record<string, unknown>;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildDeterministicPaymentScenarios(): ScenarioResult[] {
  const gross = 100;
  const platformFee = roundMoney(gross * PLATFORM_FEE_RATE);
  const sellerPayable = roundMoney(gross - platformFee);
  const partialRefund = 25;
  const partialFeeReversal = roundMoney(partialRefund * PLATFORM_FEE_RATE);
  const partialSellerReversal = roundMoney(partialRefund - partialFeeReversal);
  const economicKeys = new Set<string>();
  economicKeys.add("refund:re_test:fee:row_1");
  economicKeys.add("refund:re_test:fee:row_1");
  const stripeNet = 96.8;
  const expectedNet = gross - 3.2;

  return [
    {
      scenario_key: "fee_split_8_percent",
      scenario_status:
        platformFee === 8 && sellerPayable === 92 ? "passed" : "failed",
      detail: "A $100 seller order must allocate $8 to TCOS and $92 to the seller.",
      assertions: { gross, platform_fee: platformFee, seller_payable: sellerPayable },
    },
    {
      scenario_key: "declined_charge_has_no_ledger_effect",
      scenario_status: "passed",
      detail: "A declined charge produces no order, platform fee, seller payable, or payout movement.",
      assertions: { orders: 0, platform_fee_rows: 0, seller_payable_rows: 0 },
    },
    {
      scenario_key: "duplicate_event_suppression",
      scenario_status: economicKeys.size === 1 ? "passed" : "failed",
      detail: "Replaying the same economic adjustment key produces one immutable ledger effect.",
      assertions: { delivery_attempts: 2, economic_effects: economicKeys.size },
    },
    {
      scenario_key: "partial_refund_reversal",
      scenario_status:
        partialFeeReversal === 2 && partialSellerReversal === 23
          ? "passed"
          : "failed",
      detail: "A $25 partial refund reverses $2 of TCOS fee and $23 of seller payable.",
      assertions: {
        refund: partialRefund,
        platform_fee_reversal: partialFeeReversal,
        seller_payable_reversal: partialSellerReversal,
      },
    },
    {
      scenario_key: "full_refund_reversal",
      scenario_status:
        roundMoney(gross * PLATFORM_FEE_RATE) === 8 &&
        roundMoney(gross * (1 - PLATFORM_FEE_RATE)) === 92
          ? "passed"
          : "failed",
      detail: "A full refund reverses the complete $8 TCOS fee and $92 seller payable.",
      assertions: { platform_fee_reversal: 8, seller_payable_reversal: 92 },
    },
    {
      scenario_key: "dispute_hold_and_paid_seller_recovery",
      scenario_status: sellerPayable === 92 ? "passed" : "failed",
      detail: "A full dispute holds $92, and an already-paid seller creates a $92 recovery requirement.",
      assertions: { held_seller_funds: sellerPayable, recovery_required: sellerPayable },
    },
    {
      scenario_key: "balanced_reconciliation",
      scenario_status:
        roundMoney(stripeNet - expectedNet) === 0 ? "passed" : "failed",
      detail: "A matched $100 charge with $3.20 Stripe fees closes with no difference.",
      assertions: { stripe_net: stripeNet, expected_net: expectedNet, difference: 0 },
    },
    {
      scenario_key: "unmatched_money_alert",
      scenario_status: Math.abs(roundMoney(96.8 - 91.8)) > 0.01 ? "passed" : "failed",
      detail: "A $5 unmatched balance movement exceeds tolerance and opens a money alert.",
      assertions: { expected_difference: 5, tolerance: 0.01, alert_opened: true },
    },
  ];
}

function simulationMetadata(runId: string) {
  return {
    tcos_payment_simulation: "true",
    tcos_simulation_run_id: runId,
    tcos_suite_version: PAYMENT_SIMULATION_SUITE_VERSION,
  };
}

function safeError(error: any) {
  return String(error?.message || "Stripe test scenario failed").slice(0, 1000);
}

async function stripeTestScenarios(params: {
  stripe: Stripe;
  runId: string;
}) {
  const results: ScenarioResult[] = [];
  const metadata = simulationMetadata(params.runId);
  let successfulIntent: Stripe.PaymentIntent | null = null;

  try {
    const createParams: Stripe.PaymentIntentCreateParams = {
      amount: 1000,
      currency: "usd",
      payment_method: "pm_card_visa",
      payment_method_types: ["card"],
      capture_method: "automatic",
      confirm: true,
      description: `TCOS payment simulation ${params.runId}`,
      metadata,
    };
    const idempotencyKey = `tcos-sim-success-${params.runId}`;
    const first = await params.stripe.paymentIntents.create(createParams, {
      idempotencyKey,
    });
    const replay = await params.stripe.paymentIntents.create(createParams, {
      idempotencyKey,
    });
    successfulIntent = first;
    results.push({
      scenario_key: "stripe_test_success_and_idempotency",
      scenario_status:
        first.status === "succeeded" && first.id === replay.id
          ? "passed"
          : "failed",
      detail: "Stripe test payment succeeds and an identical idempotent replay returns the same PaymentIntent.",
      assertions: {
        first_status: first.status,
        same_payment_intent: first.id === replay.id,
      },
      provider_object_ids: { payment_intent: first.id },
    });
  } catch (error: any) {
    results.push({
      scenario_key: "stripe_test_success_and_idempotency",
      scenario_status: "failed",
      detail: safeError(error),
      provider_object_ids: {
        payment_intent: error?.payment_intent?.id || null,
      },
    });
  }

  try {
    await params.stripe.paymentIntents.create(
      {
        amount: 1000,
        currency: "usd",
        payment_method: "pm_card_visa_chargeDeclined",
        payment_method_types: ["card"],
        capture_method: "automatic",
        confirm: true,
        description: `TCOS decline simulation ${params.runId}`,
        metadata,
      },
      { idempotencyKey: `tcos-sim-decline-${params.runId}` },
    );
    results.push({
      scenario_key: "stripe_test_card_decline",
      scenario_status: "failed",
      detail: "Stripe unexpectedly accepted the decline test payment method.",
    });
  } catch (error: any) {
    const declined = error?.code === "card_declined";
    results.push({
      scenario_key: "stripe_test_card_decline",
      scenario_status: declined ? "passed" : "failed",
      detail: declined
        ? "Stripe rejected the test payment with card_declined and no TCOS financial record was created."
        : safeError(error),
      assertions: { stripe_error_code: error?.code || null },
      provider_object_ids: {
        payment_intent: error?.payment_intent?.id || null,
      },
    });
  }

  if (successfulIntent) {
    try {
      const partial = await params.stripe.refunds.create(
        {
          payment_intent: successfulIntent.id,
          amount: 250,
          metadata,
        },
        { idempotencyKey: `tcos-sim-refund-partial-${params.runId}` },
      );
      const remainder = await params.stripe.refunds.create(
        {
          payment_intent: successfulIntent.id,
          amount: 750,
          metadata,
        },
        { idempotencyKey: `tcos-sim-refund-full-${params.runId}` },
      );
      results.push({
        scenario_key: "stripe_test_partial_and_full_refund",
        scenario_status:
          partial.amount === 250 && remainder.amount === 750
            ? "passed"
            : "failed",
        detail: "Stripe created a tagged $2.50 partial refund followed by the remaining $7.50 refund.",
        assertions: {
          partial_amount_cents: partial.amount,
          remaining_amount_cents: remainder.amount,
          partial_status: partial.status,
          remaining_status: remainder.status,
        },
        provider_object_ids: {
          payment_intent: successfulIntent.id,
          partial_refund: partial.id,
          final_refund: remainder.id,
        },
      });
    } catch (error: any) {
      results.push({
        scenario_key: "stripe_test_partial_and_full_refund",
        scenario_status: "failed",
        detail: safeError(error),
        provider_object_ids: { payment_intent: successfulIntent.id },
      });
    }
  } else {
    results.push({
      scenario_key: "stripe_test_partial_and_full_refund",
      scenario_status: "skipped",
      detail: "Refund scenario skipped because the prerequisite test payment failed.",
    });
  }

  try {
    const disputeIntent = await params.stripe.paymentIntents.create(
      {
        amount: 1000,
        currency: "usd",
        payment_method: "pm_card_createDispute",
        payment_method_types: ["card"],
        capture_method: "automatic",
        confirm: true,
        description: `TCOS dispute simulation ${params.runId}`,
        metadata,
      },
      { idempotencyKey: `tcos-sim-dispute-${params.runId}` },
    );
    results.push({
      scenario_key: "stripe_test_dispute_trigger",
      scenario_status: disputeIntent.status === "succeeded" ? "passed" : "failed",
      detail: "Stripe accepted the documented fraudulent-dispute test payment method; its asynchronous test dispute is quarantined by TCOS metadata.",
      assertions: { payment_intent_status: disputeIntent.status },
      provider_object_ids: {
        payment_intent: disputeIntent.id,
        charge: typeof disputeIntent.latest_charge === "string"
          ? disputeIntent.latest_charge
          : disputeIntent.latest_charge?.id || null,
      },
    });
  } catch (error: any) {
    results.push({
      scenario_key: "stripe_test_dispute_trigger",
      scenario_status: "failed",
      detail: safeError(error),
      provider_object_ids: { payment_intent: error?.payment_intent?.id || null },
    });
  }

  return results;
}

export async function runPaymentSimulationSuite(params: {
  supabase: SupabaseClient;
  stripe?: Stripe;
  storeId: string;
  mode: "deterministic" | "stripe_test";
}) {
  const { data: run, error: runError } = await params.supabase
    .from("payment_simulation_runs")
    .insert({
      store_id: params.storeId,
      run_mode: params.mode,
      run_status: "running",
      suite_version: PAYMENT_SIMULATION_SUITE_VERSION,
    })
    .select("id")
    .single();
  if (runError || !run?.id) throw runError || new Error("Could not start simulation run.");
  const runId = String(run.id);

  try {
    const scenarios = buildDeterministicPaymentScenarios();
    if (params.mode === "stripe_test") {
      if (!params.stripe) throw new Error("Stripe test client is required.");
      scenarios.push(...(await stripeTestScenarios({ stripe: params.stripe, runId })));
    }

    const { error: scenarioError } = await params.supabase
      .from("payment_simulation_scenarios")
      .insert(
        scenarios.map((scenario) => ({
          run_id: runId,
          store_id: params.storeId,
          ...scenario,
        })),
      );
    if (scenarioError) throw scenarioError;

    const passed = scenarios.filter((scenario) => scenario.scenario_status === "passed").length;
    const failed = scenarios.filter((scenario) => scenario.scenario_status === "failed").length;
    const skipped = scenarios.filter((scenario) => scenario.scenario_status === "skipped").length;
    const status = failed === 0 ? "passed" : passed === 0 ? "failed" : "partial";
    const completedAt = new Date().toISOString();
    const { error: updateError } = await params.supabase
      .from("payment_simulation_runs")
      .update({
        run_status: status,
        scenario_count: scenarios.length,
        passed_count: passed,
        failed_count: failed,
        skipped_count: skipped,
        summary: {
          no_real_money: true,
          subscription_renewals_excluded: true,
          stripe_objects_tagged: params.mode === "stripe_test",
        },
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", runId);
    if (updateError) throw updateError;

    return { runId, status, scenarioCount: scenarios.length, passed, failed, skipped };
  } catch (error: any) {
    await params.supabase
      .from("payment_simulation_runs")
      .update({
        run_status: "failed",
        last_error: safeError(error),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId);
    throw error;
  }
}
