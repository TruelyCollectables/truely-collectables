import Stripe from "stripe";
import { getActiveStoreId } from "../../../../../lib/stores";
import { updateSellerPayoutAccountFromStripe } from "../../../../../lib/seller-payouts";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import { getOperationalStripeSecretKey } from "../../../../../lib/stripe-credentials";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SellerPayoutAccountRow = {
  id: string;
  account_id: string;
  provider_account_id: string | null;
  onboarding_status: string | null;
};

function isMissingSellerPayoutTables(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("seller_payout_accounts")
  );
}

export async function POST() {
  try {
    const stripeKey = getOperationalStripeSecretKey();

    if (!stripeKey) {
      return Response.json(
        { error: "Missing operational Stripe secret key." },
        { status: 503 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const { data, error } = await supabase
      .from("seller_payout_accounts")
      .select("id,account_id,provider_account_id,onboarding_status")
      .eq("store_id", storeId)
      .eq("provider", "stripe_connect")
      .order("updated_at", { ascending: false })
      .limit(100);

    if (error) {
      if (isMissingSellerPayoutTables(error)) {
        return Response.json(
          {
            error:
              "Seller Connect refresh is unavailable until the seller payout account migration is applied.",
          },
          { status: 503 },
        );
      }
      throw error;
    }

    const stripe = new Stripe(stripeKey);
    const accounts = ((data || []) as SellerPayoutAccountRow[]).filter(
      (account) => account.provider_account_id,
    );
    const failures: Array<{
      sellerAccountId: string;
      providerAccountId: string | null;
      error: string;
    }> = [];
    let updatedCount = 0;
    let statusChangedCount = 0;

    for (const account of accounts) {
      try {
        const stripeAccount = await stripe.accounts.retrieve(
          account.provider_account_id || "",
        );

        if ("deleted" in stripeAccount && stripeAccount.deleted) {
          throw new Error("Stripe Connect account is deleted.");
        }

        const refreshed = await updateSellerPayoutAccountFromStripe({
          supabase,
          account: stripeAccount as Stripe.Account,
          accountId: account.account_id,
          storeId,
        });

        updatedCount += 1;
        if (refreshed.onboarding_status !== account.onboarding_status) {
          statusChangedCount += 1;
        }
      } catch (error: any) {
        failures.push({
          sellerAccountId: account.account_id,
          providerAccountId: account.provider_account_id,
          error: String(error.message || "Could not refresh Connect account.").slice(
            0,
            500,
          ),
        });
      }
    }

    return Response.json({
      success: failures.length === 0,
      checkedCount: accounts.length,
      updatedCount,
      statusChangedCount,
      failedCount: failures.length,
      failures: failures.slice(0, 10),
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not refresh seller Connect statuses." },
      { status: 500 },
    );
  }
}
