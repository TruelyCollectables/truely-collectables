import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientIdentity } from "./client-identity";

export type SellerPayoutAdminEventTarget =
  | "seller_payout_ledger_entry"
  | "seller_payout_request";

export type SellerPayoutAdminEventType =
  | "ledger_status_change"
  | "request_status_change";

function isMissingAdminEventTable(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("seller_payout_admin_events")
  );
}

export async function recordSellerPayoutAdminEvent(params: {
  supabase: SupabaseClient;
  storeId: string;
  targetType: SellerPayoutAdminEventTarget;
  targetId: string;
  sellerAccountId?: string | null;
  eventType: SellerPayoutAdminEventType;
  previousStatus?: string | null;
  newStatus?: string | null;
  adminNote?: string | null;
  identity?: ClientIdentity | null;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await params.supabase
    .from("seller_payout_admin_events")
    .insert({
      store_id: params.storeId,
      target_type: params.targetType,
      target_id: params.targetId,
      seller_account_id: params.sellerAccountId ?? null,
      event_type: params.eventType,
      previous_status: params.previousStatus ?? null,
      new_status: params.newStatus ?? null,
      admin_note: params.adminNote ?? null,
      actor_type: "platform_admin",
      ip_address: params.identity?.ipAddress ?? null,
      user_agent: params.identity?.userAgent ?? null,
      identity_risk: params.identity?.risk ?? null,
      identity_evidence: params.identity?.evidence ?? {},
      metadata: params.metadata ?? {},
    });

  if (!error) return;

  if (isMissingAdminEventTable(error)) {
    console.error(
      "Seller payout admin event table unavailable:",
      error.message,
    );
    return;
  }

  throw error;
}
