import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isDryRunShippingLabel,
  isDryRunShippingReference,
} from "./shipping-dry-run";

type DryRunShippingLabelCheckRow = {
  id: string;
  metadata: Record<string, unknown> | null;
  provider_label_id: string | null;
  provider_shipment_id: string | null;
  tracking_number: string | null;
  coverage_policy_id: string | null;
};

type DryRunShippingEventCheckRow = {
  id: string;
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
