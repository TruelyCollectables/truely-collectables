import Stripe from "stripe";
import { getActiveStoreId } from "../../../../../lib/stores";
import { updateSellerPayoutAccountFromStripe } from "../../../../../lib/seller-payouts";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import {
  getOperationalStripeSecretKey,
  getStripeLiveSecretKey,
} from "../../../../../lib/stripe-credentials";
import {
  isExternalStripeConnectAccountId,
  isInternalPlatformStoreOwnerPayoutAccount,
} from "../../../../../lib/live-payment-launch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SellerPayoutAccountRow = {
  id: string;
  account_id: string;
  provider_account_id: string | null;
  onboarding_status: string | null;
  metadata: Record<string, unknown> | null;
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
    const liveStripeKey = getStripeLiveSecretKey();
    const stripeKey = liveStripeKey || getOperationalStripeSecretKey();

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
      .select("id,account_id,provider_account_id,onboarding_status,metadata")
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
    const rows = (data || []) as SellerPayoutAccountRow[];
    const internalOwnerRows = rows.filter((account) =>
      isInternalPlatformStoreOwnerPayoutAccount(account, storeId),
    );
    const externalRows = rows.filter(
      (account) => !isInternalPlatformStoreOwnerPayoutAccount(account, storeId),
    );
    const accounts = externalRows.filter((account) =>
      isExternalStripeConnectAccountId(account.provider_account_id),
    );
    const invalidRows = externalRows.filter(
      (account) => !isExternalStripeConnectAccountId(account.provider_account_id),
    );
    const failures: Array<{
      sellerAccountId: string;
      providerAccountId: string | null;
      error: string;
    }> = invalidRows.map((account) => ({
      sellerAccountId: account.account_id,
      providerAccountId: account.provider_account_id,
      error:
        "Stored external Stripe Connect account ID is invalid; expected an acct_ identifier.",
    }));
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
      stripeMode: liveStripeKey ? "live" : "test",
      checkedCount: accounts.length,
      skippedInternalOwnerCount: internalOwnerRows.length,
      invalidExternalCount: invalidRows.length,
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
