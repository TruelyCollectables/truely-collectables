import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isDryRunShippingLabel,
  isDryRunShippingReference,
} from "./shipping-dry-run";

type DryRunShippingLabelCheckRow = {
  id: string;
  order_id?: number | null;
  metadata: Record<string, unknown> | null;
  provider_label_id: string | null;
  provider_shipment_id: string | null;
  tracking_number: string | null;
  coverage_policy_id: string | null;
};

type DryRunShippingEventCheckRow = {
  id: string;
  order_id?: number | null;
  event_type: string | null;
  tracking_number: string | null;
};

type DryRunShippingOrderCheckRow = {
  id: number;
  tracking_number: string | null;
};

export type DryRunShippingCleanupSummary = {
  error: { message: string } | null;
  total: number;
  dryRunLabelCount: number;
  dryRunEventCount: number;
  dryRunOrderCount: number;
  sampleLimit: number;
  detail: string;
};

export type DryRunShippingOrderProof = {
  orderId: number;
  dryRunOrderTracking: boolean;
  dryRunLabelCount: number;
  dryRunEventCount: number;
  total: number;
  hasDryRun: boolean;
  detail: string;
};

function uniqueOrderIds(orderIds: number[]) {
  return Array.from(
    new Set(
      orderIds
        .map((orderId) => Number(orderId))
        .filter((orderId) => Number.isFinite(orderId) && orderId > 0),
    ),
  );
}

function emptyDryRunShippingOrderProof(orderId: number): DryRunShippingOrderProof {
  return {
    orderId,
    dryRunOrderTracking: false,
    dryRunLabelCount: 0,
    dryRunEventCount: 0,
    total: 0,
    hasDryRun: false,
    detail:
      "No TCOS dry-run shipping reference was found on the order, shipping labels, or tracking events.",
  };
}

function finalizeDryRunShippingOrderProof(
  proof: DryRunShippingOrderProof,
): DryRunShippingOrderProof {
  const total =
    (proof.dryRunOrderTracking ? 1 : 0) +
    proof.dryRunLabelCount +
    proof.dryRunEventCount;

  return {
    ...proof,
    total,
    hasDryRun: total > 0,
    detail:
      total > 0
        ? `${total} dry-run shipping reference(s) found for order ${proof.orderId} (${proof.dryRunLabelCount} label, ${proof.dryRunEventCount} event, ${proof.dryRunOrderTracking ? 1 : 0} order tracking).`
        : "No TCOS dry-run shipping reference was found on the order, shipping labels, or tracking events.",
  };
}

export async function getDryRunShippingCleanupSummary(params: {
  supabase: SupabaseClient;
  storeId: string;
  sampleLimit?: number;
}): Promise<DryRunShippingCleanupSummary> {
  const sampleLimit = params.sampleLimit || 1000;
  const [shippingLabelResult, shippingEventResult, shippingOrderResult] =
    await Promise.all([
      params.supabase
        .from("order_shipping_labels")
        .select(
          "id,metadata,provider_label_id,provider_shipment_id,tracking_number,coverage_policy_id",
        )
        .eq("store_id", params.storeId)
        .limit(sampleLimit),
      params.supabase
        .from("order_shipping_tracking_events")
        .select("id,event_type,tracking_number")
        .eq("store_id", params.storeId)
        .limit(sampleLimit),
      params.supabase
        .from("orders")
        .select("id,tracking_number")
        .eq("store_id", params.storeId)
        .limit(sampleLimit),
    ]);

  const error =
    shippingLabelResult.error ||
    shippingEventResult.error ||
    shippingOrderResult.error ||
    null;
  const dryRunLabelCount = (
    (shippingLabelResult.data || []) as DryRunShippingLabelCheckRow[]
  ).filter((row) => isDryRunShippingLabel(row)).length;
  const dryRunEventCount = (
    (shippingEventResult.data || []) as DryRunShippingEventCheckRow[]
  ).filter(
    (row) =>
      row.event_type === "provider_purchase_simulated" ||
      isDryRunShippingReference(row.tracking_number),
  ).length;
  const dryRunOrderCount = (
    (shippingOrderResult.data || []) as DryRunShippingOrderCheckRow[]
  ).filter((row) => isDryRunShippingReference(row.tracking_number)).length;
  const total = dryRunLabelCount + dryRunEventCount + dryRunOrderCount;

  return {
    error,
    total,
    dryRunLabelCount,
    dryRunEventCount,
    dryRunOrderCount,
    sampleLimit,
    detail: `${total} dry-run shipping reference(s) found across sampled label, tracking-event, and order rows (${dryRunLabelCount} label, ${dryRunEventCount} event, ${dryRunOrderCount} order).`,
  };
}

export async function getDryRunShippingProofByOrder(params: {
  supabase: SupabaseClient;
  storeId: string;
  orderIds: number[];
}): Promise<Map<number, DryRunShippingOrderProof>> {
  const orderIds = uniqueOrderIds(params.orderIds);
  const proofByOrderId = new Map(
    orderIds.map((orderId) => [orderId, emptyDryRunShippingOrderProof(orderId)]),
  );

  if (orderIds.length === 0) return proofByOrderId;

  const [orderResult, labelResult, eventResult] = await Promise.all([
    params.supabase
      .from("orders")
      .select("id,tracking_number")
      .eq("store_id", params.storeId)
      .in("id", orderIds),
    params.supabase
      .from("order_shipping_labels")
      .select(
        "id,order_id,metadata,provider_label_id,provider_shipment_id,tracking_number,coverage_policy_id",
      )
      .eq("store_id", params.storeId)
      .in("order_id", orderIds),
    params.supabase
      .from("order_shipping_tracking_events")
      .select("id,order_id,event_type,tracking_number")
      .eq("store_id", params.storeId)
      .in("order_id", orderIds),
  ]);

  if (orderResult.error) throw orderResult.error;
  if (labelResult.error) throw labelResult.error;
  if (eventResult.error) throw eventResult.error;

  for (const order of (orderResult.data || []) as DryRunShippingOrderCheckRow[]) {
    if (!isDryRunShippingReference(order.tracking_number)) continue;
    const proof = proofByOrderId.get(order.id);
    if (proof) proof.dryRunOrderTracking = true;
  }

  for (const label of (labelResult.data || []) as DryRunShippingLabelCheckRow[]) {
    const orderId = Number(label.order_id);
    const proof = proofByOrderId.get(orderId);
    if (!proof || !isDryRunShippingLabel(label)) continue;
    proof.dryRunLabelCount += 1;
  }

  for (const event of (eventResult.data || []) as DryRunShippingEventCheckRow[]) {
    const orderId = Number(event.order_id);
    const proof = proofByOrderId.get(orderId);
    if (!proof) continue;
    if (
      event.event_type === "provider_purchase_simulated" ||
      isDryRunShippingReference(event.tracking_number)
    ) {
      proof.dryRunEventCount += 1;
    }
  }

  return new Map(
    Array.from(proofByOrderId.entries()).map(([orderId, proof]) => [
      orderId,
      finalizeDryRunShippingOrderProof(proof),
    ]),
  );
}

export async function getDryRunShippingProofForOrder(params: {
  supabase: SupabaseClient;
  storeId: string;
  orderId: number;
}): Promise<DryRunShippingOrderProof> {
  const proofByOrderId = await getDryRunShippingProofByOrder({
    supabase: params.supabase,
    storeId: params.storeId,
    orderIds: [params.orderId],
  });

  return (
    proofByOrderId.get(params.orderId) ||
    finalizeDryRunShippingOrderProof(
      emptyDryRunShippingOrderProof(params.orderId),
    )
  );
}
