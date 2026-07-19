import Stripe from "stripe";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/account-auth";
import {
  SELLER_TERMS_OF_SERVICE_VERSION,
  hasAcceptedTerms,
} from "../../../../../lib/legal";
import { recordTermsAcceptance } from "../../../../../lib/tos-acceptance";
import { getActiveStoreId } from "../../../../../lib/stores";
import { trustedRequestOrigin } from "../../../../../lib/site-origin";
import { updateSellerPayoutAccountFromStripe } from "../../../../../lib/seller-payouts";
import {
  checkPublicEndpointRateLimit,
  publicEndpointRateLimitPolicies,
  publicEndpointRateLimitResponse,
} from "../../../../../lib/public-endpoint-rate-limit";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import { getOperationalStripeSecretKey } from "../../../../../lib/stripe-credentials";

export const dynamic = "force-dynamic";

const OWNER_EMAIL = "sales@truelycollectables.com";

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function isOwnerAccount(account: { email: string | null }) {
  return String(account.email || "").trim().toLowerCase() === OWNER_EMAIL;
}

function ownerPlatformPayoutAccountId(storeId: string) {
  return `platform_store_owner:${storeId}`;
}

function isMissingSellerPayoutTables(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("seller_payout_accounts") ||
    message.includes("account_store_memberships")
  );
}

function unavailableResponse() {
  return Response.json(
    {
      error:
        "Seller payout onboarding is not available until the seller payout migration is applied.",
    },
    { status: 503 },
  );
}

function publicSellerStatus(row: any | null) {
  if (!row) {
    return {
      provider: "stripe_connect",
      onboardingStatus: "not_started",
      payoutsEnabled: false,
      detailsSubmitted: false,
      sellerTosAccepted: false,
      updatedAt: null,
    };
  }

  return {
    provider: row.provider,
    onboardingStatus: row.onboarding_status,
    payoutsEnabled: row.payouts_enabled === true,
    detailsSubmitted: row.details_submitted === true,
    sellerTosAccepted: row.seller_tos_accepted === true,
    disabledReason: row.disabled_reason || null,
    requirementsCurrentlyDue: row.requirements_currently_due || [],
    requirementsPastDue: row.requirements_past_due || [],
    updatedAt: row.updated_at || null,
    settlementMode: row.metadata?.settlement_mode || null,
    connectRequired: row.metadata?.connect_required !== false,
  };
}

async function activateOwnerPlatformPayout(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  accountId: string;
  storeId: string;
  sellerTosVersion?: string;
  tosAcceptanceEventId?: string | null;
}) {
  const now = new Date().toISOString();
  const row = {
    account_id: params.accountId,
    store_id: params.storeId,
    provider: "stripe_connect",
    provider_account_id: ownerPlatformPayoutAccountId(params.storeId),
    onboarding_status: "active",
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    seller_tos_accepted: true,
    seller_tos_version:
      params.sellerTosVersion || SELLER_TERMS_OF_SERVICE_VERSION,
    seller_tos_accepted_at: now,
    tos_acceptance_event_id: params.tosAcceptanceEventId || null,
    disabled_reason: null,
    requirements_currently_due: [],
    requirements_past_due: [],
    metadata: {
      settlement_mode: "platform_store_owner",
      connect_required: false,
      platform_stripe_account: true,
      owner_email: OWNER_EMAIL,
      provider_account_id_kind: "internal_platform_owner",
    },
    updated_at: now,
  };

  const { data, error } = await params.supabase
    .from("seller_payout_accounts")
    .upsert(row, { onConflict: "store_id,account_id,provider" })
    .select(
      "provider,provider_account_id,onboarding_status,payouts_enabled,details_submitted,seller_tos_accepted,disabled_reason,requirements_currently_due,requirements_past_due,metadata,updated_at",
    )
    .single();

  if (error) throw error;

  await Promise.all([
    ensureAccountStoreMembership({
      accountId: params.accountId,
      role: "seller",
      status: "active",
    }),
    ensureAccountStoreMembership({
      accountId: params.accountId,
      role: "store_operator",
      status: "active",
    }),
  ]);

  return data;
}

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();

    if (isOwnerAccount(account)) {
      const ownerPayout = await activateOwnerPlatformPayout({
        supabase,
        accountId: account.id,
        storeId,
      });

      return Response.json({
        success: true,
        sellerPayout: publicSellerStatus(ownerPayout),
        providerRefreshed: false,
        connectRequired: false,
        settlementMode: "platform_store_owner",
      });
    }

    const { data, error } = await supabase
      .from("seller_payout_accounts")
      .select(
        "provider,provider_account_id,onboarding_status,payouts_enabled,details_submitted,seller_tos_accepted,disabled_reason,requirements_currently_due,requirements_past_due,metadata,updated_at",
      )
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .eq("provider", "stripe_connect")
      .maybeSingle();

    if (error) {
      if (isMissingSellerPayoutTables(error)) return unavailableResponse();
      throw error;
    }

    if (data?.provider_account_id) {
      const stripeKey = getOperationalStripeSecretKey();

      if (stripeKey) {
        try {
          const stripe = new Stripe(stripeKey);
          const stripeAccount = await stripe.accounts.retrieve(
            data.provider_account_id,
          );
          const refreshed = await updateSellerPayoutAccountFromStripe({
            supabase,
            account: stripeAccount,
            accountId: account.id,
            storeId,
          });

          return Response.json({
            success: true,
            sellerPayout: publicSellerStatus({
              ...data,
              ...refreshed,
              seller_tos_accepted: data.seller_tos_accepted,
            }),
            providerRefreshed: true,
            connectRequired: true,
          });
        } catch (refreshError: any) {
          return Response.json({
            success: true,
            sellerPayout: publicSellerStatus(data),
            providerRefreshed: false,
            connectRequired: true,
            providerRefreshError:
              refreshError.message ||
              "Could not refresh seller payout status from Stripe.",
          });
        }
      }
    }

    return Response.json({
      success: true,
      sellerPayout: publicSellerStatus(data),
      connectRequired: true,
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not load seller payout status" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const sellerTosAccepted = hasAcceptedTerms(body.sellerTosAccepted);
    const sellerTosVersion = String(
      body.sellerTosVersion || SELLER_TERMS_OF_SERVICE_VERSION,
    );

    if (!sellerTosAccepted) {
      return Response.json(
        {
          error:
            "Seller Terms of Service must be accepted before payout verification.",
        },
        { status: 400 },
      );
    }

    const rateLimit = await checkPublicEndpointRateLimit({
      request,
      ...publicEndpointRateLimitPolicies.sellerPayoutOnboarding,
      subjectKey: account.id,
    });

    if (!rateLimit.allowed) {
      const blocked = publicEndpointRateLimitResponse(rateLimit);
      return Response.json(blocked.body, { status: blocked.status });
    }

    const identity = rateLimit.identity;
    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const tosAcceptanceEventId = await recordTermsAcceptance(supabase, {
      contextType: "seller_payout_onboarding",
      tosKind: "seller",
      tosVersion: sellerTosVersion,
      identity,
      storeId,
    });

    if (isOwnerAccount(account)) {
      await activateOwnerPlatformPayout({
        supabase,
        accountId: account.id,
        storeId,
        sellerTosVersion,
        tosAcceptanceEventId,
      });

      const origin = trustedRequestOrigin(request);
      return Response.json({
        success: true,
        onboardingUrl: `${origin}/seller`,
        provider: "platform_store_owner",
        connectRequired: false,
        settlementMode: "platform_store_owner",
      });
    }

    const stripeKey = getOperationalStripeSecretKey();

    if (!stripeKey) {
      return Response.json(
        { error: "Missing Stripe secret key" },
        { status: 500 },
      );
    }

    const stripe = new Stripe(stripeKey);
    const { data: existing, error: existingError } = await supabase
      .from("seller_payout_accounts")
      .select("provider_account_id")
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .eq("provider", "stripe_connect")
      .maybeSingle();

    if (existingError) {
      if (isMissingSellerPayoutTables(existingError)) return unavailableResponse();
      throw existingError;
    }

    let stripeAccount: Stripe.Account;

    if (existing?.provider_account_id) {
      stripeAccount = await stripe.accounts.retrieve(existing.provider_account_id);
    } else {
      stripeAccount = await stripe.accounts.create({
        type: "express",
        country: "US",
        email: account.email || undefined,
        capabilities: {
          transfers: { requested: true },
        },
        metadata: {
          account_id: account.id,
          store_id: storeId,
        },
      });
    }

    await updateSellerPayoutAccountFromStripe({
      supabase,
      account: stripeAccount,
      accountId: account.id,
      storeId,
    });

    await supabase
      .from("seller_payout_accounts")
      .update({
        seller_tos_accepted: true,
        seller_tos_version: sellerTosVersion,
        seller_tos_accepted_at: new Date().toISOString(),
        tos_acceptance_event_id: tosAcceptanceEventId,
        updated_at: new Date().toISOString(),
      })
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .eq("provider", "stripe_connect");

    const origin = trustedRequestOrigin(request);
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccount.id,
      type: "account_onboarding",
      refresh_url: `${origin}/account?seller_onboarding=refresh`,
      return_url: `${origin}/account?seller_onboarding=returned`,
    });

    return Response.json({
      success: true,
      onboardingUrl: accountLink.url,
      provider: "stripe_connect",
      connectRequired: true,
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not start seller payout onboarding" },
      { status: 500 },
    );
  }
}
