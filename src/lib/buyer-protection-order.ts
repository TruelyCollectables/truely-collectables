import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BUYER_PROTECTION_FEE,
  BUYER_PROTECTION_MAX_COVERAGE,
  BUYER_PROTECTION_POLICY_VERSION,
} from "./buyer-protection";

function money(value: unknown) {
  const number = Number(value || 0);
  return Math.round(number * 100) / 100;
}

export async function persistBuyerProtectionForOrder(params: {
  supabase: SupabaseClient;
  storeId: string;
  orderId: number;
  accountId?: string | null;
  shippingMethod: string | null | undefined;
  metadata: Record<string, string>;
  isTest?: boolean;
}) {
  if (params.metadata.buyer_protection_selected !== "true") return null;

  const feeAmount = money(params.metadata.buyer_protection_fee);
  const coveredAmount = money(
    params.metadata.buyer_protection_covered_amount,
  );
  const policyVersion = params.metadata.buyer_protection_policy_version;
  const termsAcceptedAt =
    params.metadata.buyer_protection_terms_accepted_at;
  const consentSource = params.metadata.buyer_protection_consent_source;
  const preferenceMode =
    params.metadata.buyer_protection_preference_mode;

  if (params.shippingMethod !== "STANDARD_ENVELOPE") {
    throw new Error(
      "Paid Buyer Protection cannot be attached to a non-letter shipment.",
    );
  }
  if (feeAmount !== BUYER_PROTECTION_FEE) {
    throw new Error("Paid Buyer Protection fee did not match the policy fee.");
  }
  if (coveredAmount <= 0 || coveredAmount > BUYER_PROTECTION_MAX_COVERAGE) {
    throw new Error("Paid Buyer Protection coverage amount is invalid.");
  }
  if (policyVersion !== BUYER_PROTECTION_POLICY_VERSION) {
    throw new Error("Paid Buyer Protection used a stale policy version.");
  }
  if (!termsAcceptedAt || !consentSource) {
    throw new Error("Paid Buyer Protection is missing consent evidence.");
  }
  if (!["always_on", "one_time"].includes(preferenceMode)) {
    throw new Error("Paid Buyer Protection preference mode is invalid.");
  }

  const now = new Date().toISOString();
  const { data, error } = await params.supabase
    .from("order_buyer_protections")
    .upsert(
      {
        store_id: params.storeId,
        order_id: params.orderId,
        account_id: params.accountId || null,
        status: "active",
        fee_amount: feeAmount,
        covered_item_amount: coveredAmount,
        policy_version: policyVersion,
        terms_accepted_at: termsAcceptedAt,
        consent_source: consentSource,
        preference_mode: preferenceMode,
        shipping_reimbursable: false,
        protection_fee_reimbursable: false,
        consent_ip_address:
          params.metadata.buyer_protection_consent_ip_address ||
          params.metadata.tos_ip_address ||
          null,
        consent_user_agent:
          params.metadata.buyer_protection_consent_user_agent ||
          params.metadata.tos_user_agent ||
          null,
        consent_ip_risk:
          params.metadata.buyer_protection_consent_ip_risk ||
          params.metadata.tos_ip_risk ||
          null,
        consent_ip_block_reason:
          params.metadata.buyer_protection_consent_ip_block_reason ||
          params.metadata.tos_ip_block_reason ||
          null,
        metadata: {
          stripe_checkout_metadata_verified: true,
          is_test: params.isTest === true,
          non_reimbursable: ["shipping", "buyer_protection_fee"],
          claim_minimum_days_after_shipment: 7,
          claim_deadline_days_after_shipment: 21,
        },
        updated_at: now,
      },
      { onConflict: "store_id,order_id" },
    )
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(
      error?.message || "Buyer Protection order record could not be saved.",
    );
  }

  return String(data.id);
}
