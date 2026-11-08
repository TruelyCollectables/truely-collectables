import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

export type SellerPayoutStatus =
  | "not_started"
  | "payout_verification_required"
  | "pending_provider_review"
  | "active"
  | "restricted"
  | "disabled";

export function sellerPayoutStatusFromStripeAccount(
  account: Stripe.Account,
): SellerPayoutStatus {
  if (account.requirements?.disabled_reason) return "disabled";
  if (account.payouts_enabled && account.details_submitted) return "active";

  const currentlyDue = account.requirements?.currently_due ?? [];
  const pastDue = account.requirements?.past_due ?? [];

  if (pastDue.length > 0) return "restricted";
  if (currentlyDue.length > 0 || !account.details_submitted) {
    return "payout_verification_required";
  }

  return "pending_provider_review";
}

export function stripeAccountRequirementList(value: string[] | null | undefined) {
  return Array.isArray(value) ? value : [];
}

export async function updateSellerPayoutAccountFromStripe(params: {
  supabase: SupabaseClient;
  account: Stripe.Account;
  accountId?: string | null;
  storeId?: string | null;
}) {
  const accountId =
    params.accountId || String(params.account.metadata?.account_id || "");
  const storeId =
    params.storeId || String(params.account.metadata?.store_id || "");

  const payload = {
    provider: "stripe_connect",
    provider_account_id: params.account.id,
    onboarding_status: sellerPayoutStatusFromStripeAccount(params.account),
    charges_enabled: params.account.charges_enabled === true,
    payouts_enabled: params.account.payouts_enabled === true,
    details_submitted: params.account.details_submitted === true,
    requirements_currently_due: stripeAccountRequirementList(
      params.account.requirements?.currently_due,
    ),
    requirements_past_due: stripeAccountRequirementList(
      params.account.requirements?.past_due,
    ),
    disabled_reason: params.account.requirements?.disabled_reason ?? null,
    updated_at: new Date().toISOString(),
    metadata: {
      provider_country: params.account.country ?? null,
      provider_type: params.account.type ?? null,
      default_currency: params.account.default_currency ?? null,
      business_type: params.account.business_type ?? null,
    },
  };

  if (accountId && storeId) {
    const { error } = await params.supabase
      .from("seller_payout_accounts")
      .upsert(
        {
          ...payload,
          account_id: accountId,
          store_id: storeId,
        },
        { onConflict: "store_id,account_id,provider" },
      );

    if (error) throw error;

    await params.supabase
      .from("account_store_memberships")
      .upsert(
        {
          account_id: accountId,
          store_id: storeId,
          role: "seller",
          status:
            payload.onboarding_status === "active"
              ? "active"
              : "payout_verification_required",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "account_id,store_id,role" },
      );

    return payload;
  }

  const { error } = await params.supabase
    .from("seller_payout_accounts")
    .update(payload)
    .eq("provider", "stripe_connect")
    .eq("provider_account_id", params.account.id);

  if (error) throw error;

  return payload;
}
