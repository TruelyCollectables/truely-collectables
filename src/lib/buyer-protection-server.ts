import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientIdentity } from "./client-identity";
import {
  BUYER_PROTECTION_POLICY_VERSION,
  getBuyerProtectionQuote,
  isBuyerProtectionPreferenceMode,
  type BuyerProtectionPreferenceMode,
} from "./buyer-protection";

export type BuyerProtectionPreferenceRow = {
  mode: "always_on" | "always_off";
  policy_version: string | null;
  terms_accepted_at: string | null;
  opted_out_at: string | null;
};

export type BuyerProtectionSelection = {
  selected: boolean;
  feeAmount: number;
  feeBase: number;
  coveredAmount: number;
  policyVersion: string | null;
  termsAcceptedAt: string | null;
  consentSource: string | null;
  preferenceMode: BuyerProtectionPreferenceMode;
  eligibilityReason: string | null;
  declineAcknowledgedAt: string | null;
  declineConsentSource: string | null;
};

export async function getBuyerProtectionPreference(params: {
  supabase: SupabaseClient;
  storeId: string;
  accountId: string;
}) {
  const { data, error } = await params.supabase
    .from("account_buyer_protection_preferences")
    .select("mode,policy_version,terms_accepted_at,opted_out_at")
    .eq("store_id", params.storeId)
    .eq("account_id", params.accountId)
    .maybeSingle();

  if (error) throw error;
  return (data || null) as BuyerProtectionPreferenceRow | null;
}

export function isCurrentAlwaysOnPreference(
  preference: BuyerProtectionPreferenceRow | null,
) {
  return Boolean(
    preference?.mode === "always_on" &&
      preference.policy_version === BUYER_PROTECTION_POLICY_VERSION &&
      preference.terms_accepted_at,
  );
}

async function savePreference(params: {
  supabase: SupabaseClient;
  storeId: string;
  accountId: string;
  mode: "always_on" | "always_off";
  identity: ClientIdentity;
  termsAcceptedAt: string | null;
}) {
  const now = new Date().toISOString();
  const { error } = await params.supabase
    .from("account_buyer_protection_preferences")
    .upsert(
      {
        store_id: params.storeId,
        account_id: params.accountId,
        mode: params.mode,
        policy_version:
          params.mode === "always_on" ? BUYER_PROTECTION_POLICY_VERSION : null,
        terms_accepted_at:
          params.mode === "always_on" ? params.termsAcceptedAt : null,
        opted_out_at: params.mode === "always_off" ? now : null,
        acceptance_ip_address:
          params.mode === "always_on" ? params.identity.ipAddress : null,
        acceptance_user_agent:
          params.mode === "always_on" ? params.identity.userAgent : null,
        acceptance_ip_risk:
          params.mode === "always_on" ? params.identity.risk : null,
        acceptance_ip_block_reason:
          params.mode === "always_on" ? params.identity.blockReason : null,
        acceptance_ip_evidence:
          params.mode === "always_on" ? params.identity.evidence : {},
        updated_at: now,
      },
      { onConflict: "store_id,account_id" },
    );

  if (error) throw error;
}

function declinedSelection(params: {
  feeBase: number;
  preferenceMode: BuyerProtectionPreferenceMode;
  eligibilityReason: string | null;
  consentSource: string;
}) {
  const acknowledgedAt = new Date().toISOString();

  return {
    selected: false,
    feeAmount: 0,
    feeBase: params.feeBase,
    coveredAmount: 0,
    policyVersion: BUYER_PROTECTION_POLICY_VERSION,
    termsAcceptedAt: null,
    consentSource: null,
    preferenceMode: params.preferenceMode,
    eligibilityReason: params.eligibilityReason,
    declineAcknowledgedAt: acknowledgedAt,
    declineConsentSource: params.consentSource,
  } satisfies BuyerProtectionSelection;
}

export async function resolveBuyerProtectionSelection(params: {
  supabase: SupabaseClient;
  storeId: string;
  accountId?: string | null;
  shippingMethod: string;
  itemSubtotal: number;
  shippingAmount: number;
  itemCount: number;
  requestedSelected: boolean;
  requestedPreferenceMode?: unknown;
  termsAccepted: boolean;
  declineAcknowledged: boolean;
  policyVersion?: unknown;
  identity: ClientIdentity;
}): Promise<BuyerProtectionSelection> {
  const quote = getBuyerProtectionQuote({
    shippingMethod: params.shippingMethod,
    itemSubtotal: params.itemSubtotal,
    shippingAmount: params.shippingAmount,
    itemCount: params.itemCount,
  });
  const requestedMode = isBuyerProtectionPreferenceMode(
    params.requestedPreferenceMode,
  )
    ? params.requestedPreferenceMode
    : "one_time";
  const preference = params.accountId
    ? await getBuyerProtectionPreference({
        supabase: params.supabase,
        storeId: params.storeId,
        accountId: params.accountId,
      })
    : null;
  const currentAlwaysOn = isCurrentAlwaysOnPreference(preference);

  if (!quote.eligible) {
    if (params.requestedSelected && !currentAlwaysOn) {
      throw new Error(quote.reason || "Shipment Protection is not available.");
    }

    return {
      selected: false,
      feeAmount: 0,
      feeBase: quote.feeBase,
      coveredAmount: 0,
      policyVersion: null,
      termsAcceptedAt: null,
      consentSource: currentAlwaysOn
        ? "account_saved_not_applicable_to_order"
        : null,
      preferenceMode: currentAlwaysOn ? "always_on" : requestedMode,
      eligibilityReason: quote.reason,
      declineAcknowledgedAt: null,
      declineConsentSource: null,
    };
  }

  if (params.accountId && requestedMode === "always_off") {
    if (!params.declineAcknowledged) {
      throw new Error(
        "Acknowledge the Shipment Protection opt-out before checkout.",
      );
    }

    await savePreference({
      supabase: params.supabase,
      storeId: params.storeId,
      accountId: params.accountId,
      mode: "always_off",
      identity: params.identity,
      termsAcceptedAt: null,
    });

    return declinedSelection({
      feeBase: quote.feeBase,
      preferenceMode: "always_off",
      eligibilityReason: quote.reason,
      consentSource: "account_always_off_order_acknowledgment",
    });
  }

  const selected = currentAlwaysOn ? true : params.requestedSelected;

  if (!selected) {
    if (!params.declineAcknowledged) {
      throw new Error(
        "Acknowledge the Shipment Protection opt-out before checkout.",
      );
    }

    return declinedSelection({
      feeBase: quote.feeBase,
      preferenceMode: params.accountId ? requestedMode : "one_time",
      eligibilityReason: quote.reason,
      consentSource: params.accountId
        ? "account_order_decline_acknowledgment"
        : "guest_order_decline_acknowledgment",
    });
  }

  if (currentAlwaysOn && params.accountId) {
    return {
      selected: true,
      feeAmount: quote.feeAmount,
      feeBase: quote.feeBase,
      coveredAmount: quote.coveredAmount,
      policyVersion: BUYER_PROTECTION_POLICY_VERSION,
      termsAcceptedAt: preference!.terms_accepted_at,
      consentSource: "account_saved_current_policy",
      preferenceMode: "always_on",
      eligibilityReason: null,
      declineAcknowledgedAt: null,
      declineConsentSource: null,
    };
  }

  if (
    params.policyVersion !== BUYER_PROTECTION_POLICY_VERSION ||
    params.termsAccepted !== true
  ) {
    throw new Error(
      "The current Shipment Protection terms must be reviewed and accepted before protection can be added.",
    );
  }

  const termsAcceptedAt = new Date().toISOString();
  const accountMode =
    params.accountId && requestedMode === "always_on"
      ? "always_on"
      : "one_time";

  if (params.accountId && accountMode === "always_on") {
    await savePreference({
      supabase: params.supabase,
      storeId: params.storeId,
      accountId: params.accountId,
      mode: "always_on",
      identity: params.identity,
      termsAcceptedAt,
    });
  }

  return {
    selected: true,
    feeAmount: quote.feeAmount,
    feeBase: quote.feeBase,
    coveredAmount: quote.coveredAmount,
    policyVersion: BUYER_PROTECTION_POLICY_VERSION,
    termsAcceptedAt,
    consentSource:
      accountMode === "always_on"
        ? "account_new_always_on_consent"
        : params.accountId
          ? "account_one_time_consent"
          : "guest_one_time_consent",
    preferenceMode: accountMode,
    eligibilityReason: null,
    declineAcknowledgedAt: null,
    declineConsentSource: null,
  };
}
