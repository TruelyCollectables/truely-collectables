import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { PAYMENT_SIMULATION_SUITE_VERSION } from "./payment-simulations";

type Scenario = {
  scenario_key: string;
  scenario_status: "passed" | "failed" | "skipped";
  detail: string;
  assertions: Record<string, unknown>;
  provider_object_ids: Record<string, unknown>;
};

function roundMoney(value: unknown) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function safeError(error: any) {
  return String(error?.message || "Checkout E2E test failed").slice(0, 1000);
}

function stripeId(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    return String((value as { id?: unknown }).id || "") || null;
  }
  return null;
}

async function signedWebhook(params: {
  stripe: Stripe;
  webhookSecret: string;
  webhookUrl: string;
  eventId: string;
  eventType: string;
  object: unknown;
}) {
  const payload = JSON.stringify({
    id: params.eventId,
    object: "event",
    api_version: null,
    created: Math.floor(Date.now() / 1000),
    data: { object: params.object },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: params.eventType,
  });
  const signature = params.stripe.webhooks.generateTestHeaderString({
    payload,
    secret: params.webhookSecret,
  });
  const response = await fetch(params.webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": signature,
    },
    body: payload,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Webhook returned HTTP ${response.status}`);
  }
  return body;
}

async function saveRun(params: {
  supabase: SupabaseClient;
  runId: string;
  storeId: string;
  scenarios: Scenario[];
  error?: string | null;
}) {
  if (params.scenarios.length > 0) {
    const { error } = await params.supabase
      .from("payment_simulation_scenarios")
      .insert(
        params.scenarios.map((scenario) => ({
          run_id: params.runId,
          store_id: params.storeId,
          ...scenario,
        })),
      );
    if (error) throw error;
  }

  const passed = params.scenarios.filter((row) => row.scenario_status === "passed").length;
  const failed = params.scenarios.filter((row) => row.scenario_status === "failed").length;
  const skipped = params.scenarios.filter((row) => row.scenario_status === "skipped").length;
  const status = params.error || failed > 0
    ? passed > 0
      ? "partial"
      : "failed"
    : "passed";
  const completedAt = new Date().toISOString();
  const { error: updateError } = await params.supabase
    .from("payment_simulation_runs")
    .update({
      run_status: status,
      scenario_count: params.scenarios.length,
      passed_count: passed,
      failed_count: failed,
      skipped_count: skipped,
      summary: {
        no_real_money: true,
        disposable_fixture: true,
        full_checkout_path: true,
      },
      last_error: params.error || null,
      completed_at: completedAt,
      updated_at: completedAt,
    })
    .eq("id", params.runId);
  if (updateError) throw updateError;

  return { status, passed, failed, skipped };
}

export async function runCheckoutE2ESimulation(params: {
  supabase: SupabaseClient;
  stripe: Stripe;
  storeId: string;
  appOrigin: string;
  webhookSecret: string;
}) {
  const { data: run, error: runError } = await params.supabase
    .from("payment_simulation_runs")
    .insert({
      store_id: params.storeId,
      run_mode: "checkout_e2e",
      run_status: "running",
      suite_version: PAYMENT_SIMULATION_SUITE_VERSION,
    })
    .select("id")
    .single();
  if (runError || !run?.id) throw runError || new Error("Could not start checkout E2E run.");

  const runId = String(run.id);
  const checkoutAttemptId = randomUUID();
  const scenarios: Scenario[] = [];
  let productId: number | null = null;
  let checkoutSessionId: string | null = null;
  let orderId: number | null = null;

  try {
    const { data: product, error: productError } = await params.supabase
      .from("products")
      .insert({
        store_id: params.storeId,
        title: `[TCOS TEST] Checkout E2E ${runId.slice(0, 8)}`,
        description: "Disposable non-eBay payment reliability fixture.",
        price: 10,
        quantity: 1,
        sku: `TCOS-TEST-${runId.slice(0, 8).toUpperCase()}`,
        ebay_item_id: null,
        seller_account_id: null,
      })
      .select("id")
      .single();
    if (productError || !product?.id) throw productError || new Error("Could not create test product.");
    productId = Number(product.id);
    scenarios.push({
      scenario_key: "disposable_non_ebay_fixture",
      scenario_status: "passed",
      detail: "Created a one-unit local-only product isolated from eBay inventory.",
      assertions: { quantity: 1, price: 10, ebay_linked: false },
      provider_object_ids: { product_id: productId },
    });

    const checkoutBody = {
      cart: [{ id: productId, quantity: 1 }],
      shippingMethod: "GROUND_ADVANTAGE",
      tosAccepted: true,
      checkoutAttemptId,
    };
    const checkoutRequest = () =>
      fetch(`${params.appOrigin}/api/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checkoutBody),
      });
    const firstCheckout = await checkoutRequest();
    const firstBody = await firstCheckout.json().catch(() => ({}));
    if (!firstCheckout.ok) throw new Error(firstBody.error || "Checkout API failed.");
    const replayCheckout = await checkoutRequest();
    const replayBody = await replayCheckout.json().catch(() => ({}));
    if (!replayCheckout.ok) throw new Error(replayBody.error || "Checkout replay failed.");

    const { data: checkoutAttempt, error: checkoutAttemptError } = await params.supabase
      .from("checkout_attempts")
      .select("stripe_session_id,attempt_count,request_status")
      .eq("store_id", params.storeId)
      .eq("checkout_attempt_id", checkoutAttemptId)
      .single();
    if (checkoutAttemptError || !checkoutAttempt?.stripe_session_id) {
      throw checkoutAttemptError || new Error("Checkout attempt session was not saved.");
    }
    checkoutSessionId = String(checkoutAttempt.stripe_session_id);
    scenarios.push({
      scenario_key: "checkout_session_and_duplicate_request",
      scenario_status:
        replayBody.replayed === true && firstBody.url === replayBody.url
          ? "passed"
          : "failed",
      detail: "The storefront created one hosted Checkout Session and returned it for the duplicate request.",
      assertions: {
        first_replayed: firstBody.replayed === true,
        second_replayed: replayBody.replayed === true,
        same_url: firstBody.url === replayBody.url,
        attempt_count: checkoutAttempt.attempt_count,
      },
      provider_object_ids: { checkout_session: checkoutSessionId },
    });

    const session = await params.stripe.checkout.sessions.retrieve(checkoutSessionId);
    const metadata = {
      ...(session.metadata || {}),
      tcos_e2e_checkout: "true",
      tcos_simulation_run_id: runId,
    };
    const paymentIntent = await params.stripe.paymentIntents.create(
      {
        amount: Number(session.amount_total || 0),
        currency: "usd",
        payment_method: "pm_card_visa",
        payment_method_types: ["card"],
        capture_method: "automatic",
        confirm: true,
        description: `TCOS checkout E2E ${runId}`,
        metadata: {
          tcos_e2e_checkout: "true",
          tcos_simulation_run_id: runId,
        },
      },
      { idempotencyKey: `tcos-checkout-e2e-payment-${runId}` },
    );
    const completedSession = {
      ...session,
      status: "complete",
      payment_status: "paid",
      payment_intent: paymentIntent,
      metadata,
      customer_details: {
        email: "checkout-e2e@truelycollectables.com",
        name: "TCOS Test Buyer",
        address: {
          line1: "100 Test Lane",
          line2: null,
          city: "Denver",
          state: "CO",
          postal_code: "80202",
          country: "US",
        },
      },
      collected_information: {
        shipping_details: {
          name: "TCOS Test Buyer",
          address: {
            line1: "100 Test Lane",
            line2: null,
            city: "Denver",
            state: "CO",
            postal_code: "80202",
            country: "US",
          },
        },
      },
    };
    const checkoutEventId = `evt_tcos_e2e_process_checkout_${runId.replaceAll("-", "")}`;
    await signedWebhook({
      stripe: params.stripe,
      webhookSecret: params.webhookSecret,
      webhookUrl: `${params.appOrigin}/api/webhook`,
      eventId: checkoutEventId,
      eventType: "checkout.session.completed",
      object: completedSession,
    });

    const { data: order, error: orderError } = await params.supabase
      .from("orders")
      .select("id,total,status,payment_status,stripe_payment_intent_id,stripe_charge_id,is_test,test_run_id")
      .eq("store_id", params.storeId)
      .eq("test_run_id", runId)
      .single();
    if (orderError || !order) throw orderError || new Error("Test order was not created.");
    orderId = Number(order.id);
    const [items, productAfter, fees, evidence] = await Promise.all([
      params.supabase.from("order_items").select("id,quantity,is_test,test_run_id").eq("order_id", orderId),
      params.supabase.from("products").select("quantity").eq("id", productId).single(),
      params.supabase.from("platform_fee_ledger_entries").select("id,total_basis_amount,platform_fee_rate,platform_fee_amount").eq("order_id", orderId),
      params.supabase.from("transaction_evidence_reports").select("id,status,email_sent_at").eq("order_id", orderId),
    ]);
    for (const result of [items, productAfter, fees, evidence]) {
      if (result.error) throw result.error;
    }
    scenarios.push({
      scenario_key: "paid_order_and_inventory_decrement",
      scenario_status:
        order.status === "paid" &&
        order.is_test === true &&
        productAfter.data?.quantity === 0 &&
        items.data?.length === 1
          ? "passed"
          : "failed",
      detail: "The signed completed Checkout event created a test-tagged paid order and decremented the disposable product from one to zero.",
      assertions: {
        order_status: order.status,
        payment_status: order.payment_status,
        test_tagged: order.is_test,
        inventory_quantity: productAfter.data?.quantity,
        order_items: items.data?.length || 0,
      },
      provider_object_ids: {
        order_id: orderId,
        payment_intent: paymentIntent.id,
        charge: stripeId(paymentIntent.latest_charge),
      },
    });
    const fee = fees.data?.[0];
    scenarios.push({
      scenario_key: "checkout_8_percent_fee_ledger",
      scenario_status:
        fees.data?.length === 1 &&
        roundMoney(fee?.platform_fee_rate) === 0.08 &&
        roundMoney(fee?.platform_fee_amount) ===
          roundMoney(Number(fee?.total_basis_amount || 0) * 0.08)
          ? "passed"
          : "failed",
      detail: "The checkout created one Dag Danky Holdings LLC platform-fee row at exactly 8% of item plus allocated shipping.",
      assertions: {
        fee_rows: fees.data?.length || 0,
        fee_rate: fee?.platform_fee_rate || null,
        total_basis: fee?.total_basis_amount || null,
        fee_amount: fee?.platform_fee_amount || null,
      },
      provider_object_ids: { platform_fee_row: fee?.id || null },
    });
    scenarios.push({
      scenario_key: "transaction_evidence_packet",
      scenario_status: evidence.data?.length === 1 ? "passed" : "failed",
      detail: "The paid checkout saved its transaction evidence packet without emailing the disposable test artifact.",
      assertions: {
        evidence_rows: evidence.data?.length || 0,
        email_sent: Boolean(evidence.data?.[0]?.email_sent_at),
      },
      provider_object_ids: { evidence_report: evidence.data?.[0]?.id || null },
    });

    const refund = await params.stripe.refunds.create(
      {
        payment_intent: paymentIntent.id,
        metadata: {
          tcos_e2e_checkout: "true",
          tcos_simulation_run_id: runId,
        },
      },
      { idempotencyKey: `tcos-checkout-e2e-refund-${runId}` },
    );
    await signedWebhook({
      stripe: params.stripe,
      webhookSecret: params.webhookSecret,
      webhookUrl: `${params.appOrigin}/api/webhook`,
      eventId: `evt_tcos_e2e_process_refund_${runId.replaceAll("-", "")}`,
      eventType: "refund.created",
      object: refund,
    });

    const [refundedOrder, refundObject, adjustments, reversedFee] = await Promise.all([
      params.supabase.from("orders").select("payment_status,refund_status,amount_refunded").eq("id", orderId).single(),
      params.supabase.from("stripe_post_payment_objects").select("id,provider_object_id,amount,current_status").eq("order_id", orderId).eq("object_type", "refund"),
      params.supabase.from("financial_adjustment_ledger_entries").select("id,entry_type,ledger_account,amount").eq("order_id", orderId),
      params.supabase.from("platform_fee_ledger_entries").select("platform_fee_amount,fee_status").eq("order_id", orderId).single(),
    ]);
    for (const result of [refundedOrder, refundObject, adjustments, reversedFee]) {
      if (result.error) throw result.error;
    }
    const feeReversal = adjustments.data?.find((row) => row.entry_type === "platform_fee_reversal");
    scenarios.push({
      scenario_key: "full_refund_and_fee_reversal",
      scenario_status:
        refundedOrder.data?.payment_status === "refunded" &&
        roundMoney(refundedOrder.data?.amount_refunded) ===
          roundMoney(Number(session.amount_total || 0) / 100) &&
        refundObject.data?.length === 1 &&
        roundMoney(feeReversal?.amount) === roundMoney(fee?.platform_fee_amount)
          ? "passed"
          : "failed",
      detail: "A real Stripe test refund drove the signed refund webhook, immutable adjustments, full order refund state, and complete 8% fee reversal.",
      assertions: {
        payment_status: refundedOrder.data?.payment_status,
        amount_refunded: refundedOrder.data?.amount_refunded,
        refund_objects: refundObject.data?.length || 0,
        adjustment_rows: adjustments.data?.length || 0,
        platform_fee_reversal: feeReversal?.amount || null,
        fee_status: reversedFee.data?.fee_status,
      },
      provider_object_ids: { refund: refund.id },
    });
    scenarios.push({
      scenario_key: "scoped_stripe_tcos_reconciliation",
      scenario_status:
        order.stripe_payment_intent_id === paymentIntent.id &&
        order.stripe_charge_id === stripeId(paymentIntent.latest_charge) &&
        refundObject.data?.[0]?.provider_object_id === refund.id &&
        roundMoney(refundObject.data?.[0]?.amount) ===
          roundMoney(Number(session.amount_total || 0) / 100)
          ? "passed"
          : "failed",
      detail: "The Stripe PaymentIntent, charge, refund, TCOS order, and post-payment object matched by provider IDs and amount.",
      assertions: {
        payment_intent_match: order.stripe_payment_intent_id === paymentIntent.id,
        charge_match: order.stripe_charge_id === stripeId(paymentIntent.latest_charge),
        refund_match: refundObject.data?.[0]?.provider_object_id === refund.id,
        amount_match:
          roundMoney(refundObject.data?.[0]?.amount) ===
          roundMoney(Number(session.amount_total || 0) / 100),
      },
      provider_object_ids: {
        payment_intent: paymentIntent.id,
        charge: stripeId(paymentIntent.latest_charge),
        refund: refund.id,
      },
    });
  } catch (error: any) {
    scenarios.push({
      scenario_key: "checkout_e2e_execution",
      scenario_status: "failed",
      detail: safeError(error),
      assertions: {},
      provider_object_ids: {
        product_id: productId,
        checkout_session: checkoutSessionId,
        order_id: orderId,
      },
    });
  }

  try {
    if (checkoutSessionId) {
      const session = await params.stripe.checkout.sessions.retrieve(checkoutSessionId);
      if (session.status === "open") {
        await params.stripe.checkout.sessions.expire(checkoutSessionId);
      }
    }
    if (productId) {
      const { data, error } = await params.supabase.rpc("tcos_cleanup_checkout_e2e", {
        p_store_id: params.storeId,
        p_test_run_id: runId,
        p_product_id: productId,
        p_checkout_attempt_id: checkoutAttemptId,
      });
      if (error) throw error;
      scenarios.push({
        scenario_key: "fixture_cleanup_and_financial_isolation",
        scenario_status:
          Number(data?.orders_deleted || 0) <= 1 &&
          Number(data?.products_deleted || 0) === 1
            ? "passed"
            : "failed",
        detail: "The run-scoped cleanup removed the test order, evidence, financial rows, checkout journal, and disposable product.",
        assertions: data || {},
        provider_object_ids: { product_id: productId, order_id: orderId },
      });
    }
  } catch (cleanupError: any) {
    scenarios.push({
      scenario_key: "fixture_cleanup_and_financial_isolation",
      scenario_status: "failed",
      detail: safeError(cleanupError),
      assertions: {},
      provider_object_ids: { product_id: productId, order_id: orderId },
    });
  }

  const result = await saveRun({
    supabase: params.supabase,
    runId,
    storeId: params.storeId,
    scenarios,
  });
  return { runId, scenarioCount: scenarios.length, ...result };
}
