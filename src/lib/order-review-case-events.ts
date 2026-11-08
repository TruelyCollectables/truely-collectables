import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientIdentity } from "./client-identity";

export type OrderReviewCaseEventType =
  | "case_created"
  | "case_status_change"
  | "seller_payout_hold_applied"
  | "seller_payout_hold_skipped"
  | "fulfillment_hold_applied"
  | "case_note_added";

function isMissingCaseEventTable(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("order_review_case_events")
  );
}

export async function recordOrderReviewCaseEvent(params: {
  supabase: SupabaseClient;
  storeId: string;
  caseId: string;
  orderId: number;
  sellerAccountId?: string | null;
  eventType: OrderReviewCaseEventType;
  previousStatus?: string | null;
  newStatus?: string | null;
  note?: string | null;
  identity?: ClientIdentity | null;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await params.supabase
    .from("order_review_case_events")
    .insert({
      store_id: params.storeId,
      case_id: params.caseId,
      order_id: params.orderId,
      seller_account_id: params.sellerAccountId ?? null,
      event_type: params.eventType,
      previous_status: params.previousStatus ?? null,
      new_status: params.newStatus ?? null,
      note: params.note ?? null,
      actor_type: "platform_admin",
      ip_address: params.identity?.ipAddress ?? null,
      user_agent: params.identity?.userAgent ?? null,
      identity_risk: params.identity?.risk ?? null,
      identity_evidence: params.identity?.evidence ?? {},
      metadata: params.metadata ?? {},
    });

  if (!error) return;

  if (isMissingCaseEventTable(error)) {
    console.error("Order review case event table unavailable:", error.message);
    return;
  }

  throw error;
}
