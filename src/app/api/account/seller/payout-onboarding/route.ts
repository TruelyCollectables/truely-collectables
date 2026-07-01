import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { getAuthenticatedAccountFromRequest } from "../../../../../lib/account-auth";
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

export const dynamic = "force-dynamic";

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
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
  };
}

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const { data, error } = await supabase
      .from("seller_payout_accounts")
      .select(
        "provider,onboarding_status,payouts_enabled,details_submitted,seller_tos_accepted,disabled_reason,requirements_currently_due,requirements_past_due,updated_at",
      )
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .eq("provider", "stripe_connect")
      .maybeSingle();

    if (error) {
      if (isMissingSellerPayoutTables(error)) return unavailableResponse();
      throw error;
    }

    return Response.json({
      success: true,
      sellerPayout: publicSellerStatus(data),
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
    const stripeKey = process.env.STRIPE_SECRET_KEY;

    if (!stripeKey) {
      return Response.json(
        { error: "Missing Stripe secret key" },
        { status: 500 },
      );
    }

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
      return Response.json(
        blocked.body,
        { status: blocked.status },
      );
    }

    const identity = rateLimit.identity;

    const supabase = getSupabaseClient();
    const stripe = new Stripe(stripeKey);
    const storeId = getActiveStoreId();
    const tosAcceptanceEventId = await recordTermsAcceptance(supabase, {
      contextType: "seller_payout_onboarding",
      tosKind: "seller",
      tosVersion: sellerTosVersion,
      identity,
      storeId,
    });

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
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not start seller payout onboarding" },
      { status: 500 },
    );
  }
}
