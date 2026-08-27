import { NextResponse } from "next/server";
import {
  accountAuthResponseHeaders,
  createOrUpdateAccountProfile,
  ensureAccountStoreMembership,
  recordAccountAuthEvent,
} from "../../../../lib/account-auth";
import {
  accountAuthBlockedResponse,
  checkAccountAuthAllowed,
} from "../../../../lib/account-login-security";
import {
  BUYER_ACCOUNT_ACTIVE_STATUS,
  BUYER_CARD_VERIFICATION_REQUIRED,
  BUYER_MEMBERSHIP_ACTIVE_STATUS,
} from "../../../../lib/buyer-account-policy";
import {
  TERMS_OF_SERVICE_VERSION,
  hasAcceptedTerms,
} from "../../../../lib/legal";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

function getSupabaseClient() {
  return createSupabaseServerClient();
}

export async function POST(request: Request) {
  let email = "";

  try {
    const body = await request.json();
    email = String(body.email || "")
      .trim()
      .toLowerCase();
    const password = String(body.password || "");
    const displayName = String(body.displayName || "").trim();
    const tosAccepted = hasAcceptedTerms(body.tosAccepted);
    const tosVersion = String(body.tosVersion || TERMS_OF_SERVICE_VERSION);

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        {
          status: 400,
          headers: accountAuthResponseHeaders({
            action: "signup",
            status: "missing_credentials",
            cardVerification: "not_required",
            session: "not_issued",
            membership: "none",
          }),
        },
      );
    }

    if (password.length < 10) {
      return NextResponse.json(
        { error: "Password must be at least 10 characters" },
        {
          status: 400,
          headers: accountAuthResponseHeaders({
            action: "signup",
            status: "weak_password",
            cardVerification: "not_required",
            session: "not_issued",
            membership: "none",
          }),
        },
      );
    }

    if (!tosAccepted) {
      return NextResponse.json(
        {
          error: "Terms of Service must be accepted before creating an account",
        },
        {
          status: 400,
          headers: accountAuthResponseHeaders({
            action: "signup",
            status: "terms_required",
            cardVerification: "not_required",
            session: "not_issued",
            membership: "none",
          }),
        },
      );
    }

    const securityCheck = await checkAccountAuthAllowed({
      request,
      email,
      eventType: "signup",
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
        {
          status: blocked.status,
          headers: accountAuthResponseHeaders({
            action: "signup",
            status: "blocked",
            cardVerification: "not_required",
            session: "not_issued",
            membership: "none",
          }),
        },
      );
    }

    const supabase = getSupabaseClient();
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
        {
          status: 400,
          headers: accountAuthResponseHeaders({
            action: "signup",
            status: "signup_failed",
            cardVerification: "not_required",
            session: "not_issued",
            membership: "none",
          }),
        },
      );
    }

    await createOrUpdateAccountProfile({
      accountId: data.user.id,
      email,
      displayName,
      defaultAccountType: "buyer",
      accountStatus: BUYER_ACCOUNT_ACTIVE_STATUS,
      tosAccepted,
      tosVersion,
      cardVerified: false,
      cardVerifiedAt: null,
    });

    await ensureAccountStoreMembership({
      accountId: data.user.id,
      role: "buyer",
      status: BUYER_MEMBERSHIP_ACTIVE_STATUS,
    });

    await recordAccountAuthEvent({
      request,
      accountId: data.user.id,
      email,
      eventType: "signup",
      success: true,
    });

    return NextResponse.json(
      {
        success: true,
        userId: data.user.id,
        email,
        emailConfirmationRequired: !data.session,
        accountStatus: BUYER_ACCOUNT_ACTIVE_STATUS,
        cardVerificationRequired: BUYER_CARD_VERIFICATION_REQUIRED,
        stripeSessionId: null,
        cardVerificationUrl: null,
        session: data.session,
      },
      {
        headers: accountAuthResponseHeaders({
          action: "signup",
          status: "created_active_buyer",
          cardVerification: "not_required",
          session: data.session ? "issued" : "not_issued",
          membership: "buyer",
        }),
      },
    );
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
      {
        status: 500,
        headers: accountAuthResponseHeaders({
          action: "signup",
          status: "error",
          cardVerification: "not_required",
          session: "not_issued",
          membership: "none",
        }),
      },
    );
  }
}
