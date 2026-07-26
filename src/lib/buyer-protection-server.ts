import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientIdentity } from "./client-identity";
import {
  BUYER_PROTECTION_FEE,
  BUYER_PROTECTION_POLICY_VERSION,
  getBuyerProtectionEligibility,
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
  coveredAmount: number;
  policyVersion: string | null;
  termsAcceptedAt: string | null;
  consentSource: string | null;
  preferenceMode: BuyerProtectionPreferenceMode;
  eligibilityReason: string | null;
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

export async function resolveBuyerProtectionSelection(params: {
  supabase: SupabaseClient;
  storeId: string;
  accountId?: string | null;
  shippingMethod: string;
  itemSubtotal: number;
  itemCount: number;
  requestedSelected: boolean;
  requestedPreferenceMode?: unknown;
  termsAccepted: boolean;
  policyVersion?: unknown;
  identity: ClientIdentity;
}): Promise<BuyerProtectionSelection> {
  const eligibility = getBuyerProtectionEligibility({
    shippingMethod: params.shippingMethod,
    itemSubtotal: params.itemSubtotal,
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

  if (params.accountId && requestedMode === "always_off") {
    await savePreference({
      supabase: params.supabase,
      storeId: params.storeId,
      accountId: params.accountId,
      mode: "always_off",
      identity: params.identity,
      termsAcceptedAt: null,
    });

    return {
      selected: false,
      feeAmount: 0,
      coveredAmount: 0,
      policyVersion: null,
      termsAcceptedAt: null,
      consentSource: "account_always_off",
      preferenceMode: "always_off",
      eligibilityReason: eligibility.reason,
    };
  }

  const selected = currentAlwaysOn
    ? true
    : params.requestedSelected;

  if (!selected) {
    return {
      selected: false,
      feeAmount: 0,
      coveredAmount: 0,
      policyVersion: null,
      termsAcceptedAt: null,
      consentSource: null,
      preferenceMode: params.accountId ? requestedMode : "one_time",
      eligibilityReason: eligibility.reason,
    };
  }

  if (!eligibility.eligible) {
    throw new Error(eligibility.reason || "Buyer Protection is not available.");
  }

  if (currentAlwaysOn && params.accountId) {
    return {
      selected: true,
      feeAmount: BUYER_PROTECTION_FEE,
      coveredAmount: eligibility.coveredAmount,
      policyVersion: BUYER_PROTECTION_POLICY_VERSION,
      termsAcceptedAt: preference!.terms_accepted_at,
      consentSource: "account_saved_current_policy",
      preferenceMode: "always_on",
      eligibilityReason: null,
    };
  }

  if (
    params.policyVersion !== BUYER_PROTECTION_POLICY_VERSION ||
    params.termsAccepted !== true
  ) {
    throw new Error(
      "The current Buyer Protection terms must be reviewed and accepted before protection can be added.",
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
    feeAmount: BUYER_PROTECTION_FEE,
    coveredAmount: eligibility.coveredAmount,
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
  };
}
