import { NextResponse } from "next/server";
import Stripe from "stripe";
import {
  createOrUpdateAccountProfile,
  ensureAccountStoreMembership,
  recordAccountAuthEvent,
} from "../../../../lib/account-auth";
import {
  accountAuthBlockedResponse,
  checkAccountAuthAllowed,
} from "../../../../lib/account-login-security";
import {
  TERMS_OF_SERVICE_VERSION,
  hasAcceptedTerms,
} from "../../../../lib/legal";
import { getActiveStoreId } from "../../../../lib/stores";
import { trustedRequestOrigin } from "../../../../lib/site-origin";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { getStripePaymentRuntime } from "../../../../lib/live-payment-launch";

export const dynamic = "force-dynamic";

function accountCardVerificationRequired() {
  return process.env.ACCOUNT_CARD_VERIFICATION_REQUIRED !== "false";
}

function getSupabaseClient() {
  return createSupabaseServerClient();
}

export async function POST(request: Request) {
  let email = "";

  try {
    const body = await request.json();
    email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const displayName = String(body.displayName || "").trim();
    const tosAccepted = hasAcceptedTerms(body.tosAccepted);
    const tosVersion = String(body.tosVersion || TERMS_OF_SERVICE_VERSION);
    const cardVerificationRequired = accountCardVerificationRequired();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 },
      );
    }

    if (password.length < 10) {
      return NextResponse.json(
        { error: "Password must be at least 10 characters" },
        { status: 400 },
      );
    }

    if (!tosAccepted) {
      return NextResponse.json(
        { error: "Terms of Service must be accepted before creating an account" },
        { status: 400 },
      );
    }

    const securityCheck = await checkAccountAuthAllowed({
      request,
      email,
      eventType: "signup",
      allowBlockedIdentity: cardVerificationRequired,
    });

    if (!securityCheck.allowed) {
      await recordAccountAuthEvent({
        request,
        email,
        eventType: "signup",
        success: false,
        failureReason: securityCheck.reason || "blocked",
        lockoutUntil: securityCheck.lockoutUntil,
      });

      const blocked = accountAuthBlockedResponse(securityCheck);
      return NextResponse.json(
        { error: blocked.error },
        { status: blocked.status },
      );
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    let stripeKey: string | null = null;
    if (cardVerificationRequired) {
      const stripeRuntime = await getStripePaymentRuntime({
        storeId,
      });
      if (!stripeRuntime.allowed || !stripeRuntime.stripeKey) {
        return NextResponse.json(
          { error: stripeRuntime.reason },
          { status: 503 },
        );
      }
      stripeKey = stripeRuntime.stripeKey;
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName || null,
          tcos_account_type: "buyer",
          tos_version: tosVersion,
        },
      },
    });

    if (error || !data.user) {
      await recordAccountAuthEvent({
        request,
        email,
        eventType: "signup",
        success: false,
        failureReason: error?.message || "signup_failed",
      });

      return NextResponse.json(
        { error: error?.message || "Account signup failed" },
        { status: 400 },
      );
    }

    const accountStatus = cardVerificationRequired
      ? "payment_verification_required"
      : "active";

    await createOrUpdateAccountProfile({
      accountId: data.user.id,
      email,
      displayName,
      defaultAccountType: "buyer",
      accountStatus,
      tosAccepted,
      tosVersion,
      cardVerified: !cardVerificationRequired,
      cardVerifiedAt: cardVerificationRequired ? null : new Date().toISOString(),
    });

    await ensureAccountStoreMembership({
      accountId: data.user.id,
      role: "buyer",
      status: cardVerificationRequired
        ? "payment_verification_required"
        : "active",
    });

    await recordAccountAuthEvent({
      request,
      accountId: data.user.id,
      email,
      eventType: "signup",
      success: true,
    });

    let cardVerificationUrl: string | null = null;
    let stripeSessionId: string | null = null;

    if (cardVerificationRequired && stripeKey) {
      const stripe = new Stripe(stripeKey);
      const origin = trustedRequestOrigin(request);
      const metadata = {
        type: "account_card_verification_setup",
        account_id: data.user.id,
        store_id: storeId,
        email,
      };
      const session = await stripe.checkout.sessions.create({
        mode: "setup",
        payment_method_types: ["card"],
        customer_email: email,
        client_reference_id: data.user.id,
        billing_address_collection: "required",
        metadata,
        setup_intent_data: {
          metadata,
        },
        success_url: `${origin}/account/login?card_verification=submitted`,
        cancel_url: `${origin}/account/signup?card_verification=canceled`,
      });

      stripeSessionId = session.id;
      cardVerificationUrl = session.url;
    }

    return NextResponse.json({
      success: true,
      userId: data.user.id,
      email,
      emailConfirmationRequired: !data.session,
      accountStatus,
      cardVerificationRequired,
      stripeSessionId,
      cardVerificationUrl,
      session: cardVerificationRequired ? null : data.session,
    });
  } catch (error: any) {
    await recordAccountAuthEvent({
      request,
      email,
      eventType: "signup",
      success: false,
      failureReason: error.message || "signup_exception",
    }).catch(() => undefined);

    return NextResponse.json(
      { error: error.message || "Account signup failed" },
      { status: 500 },
    );
  }
}
