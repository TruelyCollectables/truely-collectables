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
  BUYER_MEMBERSHIP_ACTIVE_STATUS,
  isBuyerAccountType,
  shouldActivateLegacyBuyerAccount,
} from "../../../../lib/buyer-account-policy";
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

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        {
          status: 400,
          headers: accountAuthResponseHeaders({
            action: "login",
            status: "missing_credentials",
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
      eventType: "login",
    });

    if (!securityCheck.allowed) {
      await recordAccountAuthEvent({
        request,
        email,
        eventType: "login",
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
            action: "login",
            status: "blocked",
            cardVerification: "not_required",
            session: "not_issued",
            membership: "none",
          }),
        },
      );
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user || !data.session) {
      await recordAccountAuthEvent({
        request,
        email,
        eventType: "login",
        success: false,
        failureReason: error?.message || "invalid_credentials",
      });

      return NextResponse.json(
        { error: error?.message || "Account login failed" },
        {
          status: 401,
          headers: accountAuthResponseHeaders({
            action: "login",
            status: "invalid_credentials",
            cardVerification: "not_required",
            session: "not_issued",
            membership: "none",
          }),
        },
      );
    }

    const authAccountType = data.user.user_metadata?.tcos_account_type;
    let profile = await createOrUpdateAccountProfile({
      accountId: data.user.id,
      email,
      displayName:
        typeof data.user.user_metadata?.display_name === "string"
          ? data.user.user_metadata.display_name
          : null,
      preserveDefaultAccountType: true,
    });

    if (
      shouldActivateLegacyBuyerAccount({
        accountStatus: profile?.account_status,
        defaultAccountType: profile?.default_account_type,
        authAccountType,
      })
    ) {
      profile = await createOrUpdateAccountProfile({
        accountId: data.user.id,
        email,
        displayName: profile?.display_name || null,
        defaultAccountType: "buyer",
        accountStatus: BUYER_ACCOUNT_ACTIVE_STATUS,
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
        eventType: "buyer_card_verification_requirement_removed",
        success: true,
      });
    }

    const buyerAccount = isBuyerAccountType(
      profile?.default_account_type,
      authAccountType,
    );

    if (profile?.account_status === "payment_verification_required") {
      await recordAccountAuthEvent({
        request,
        accountId: data.user.id,
        email,
        eventType: "login",
        success: false,
        failureReason: "seller_payment_verification_required",
      });

      return NextResponse.json(
        {
          error:
            "Seller verification must be completed through TCOS seller onboarding before seller access is activated.",
        },
        {
          status: 403,
          headers: accountAuthResponseHeaders({
            action: "login",
            status: "seller_payment_verification_required",
            cardVerification: "seller_only",
            session: "not_issued",
            membership: "none",
          }),
        },
      );
    }

    if (profile?.account_status && profile.account_status !== "active") {
      await recordAccountAuthEvent({
        request,
        accountId: data.user.id,
        email,
        eventType: "login",
        success: false,
        failureReason: profile.account_status,
      });

      return NextResponse.json(
        { error: "This account is not active." },
        {
          status: 403,
          headers: accountAuthResponseHeaders({
            action: "login",
            status: "inactive",
            cardVerification: buyerAccount ? "not_required" : "seller_only",
            session: "not_issued",
            membership: "none",
          }),
        },
      );
    }

    await ensureAccountStoreMembership({
      accountId: data.user.id,
      role: "buyer",
      status: BUYER_MEMBERSHIP_ACTIVE_STATUS,
    });

    await recordAccountAuthEvent({
      request,
      accountId: data.user.id,
      email,
      eventType: "login",
      success: true,
    });

    return NextResponse.json(
      {
        success: true,
        userId: data.user.id,
        email,
        session: data.session,
      },
      {
        headers: accountAuthResponseHeaders({
          action: "login",
          status: "authenticated",
          cardVerification: buyerAccount ? "not_required" : "seller_only",
          session: "issued",
          membership: "buyer",
        }),
      },
    );
  } catch (error: any) {
    await recordAccountAuthEvent({
      request,
      email,
      eventType: "login",
      success: false,
      failureReason: error.message || "login_exception",
    }).catch(() => undefined);

    return NextResponse.json(
      { error: error.message || "Account login failed" },
      {
        status: 500,
        headers: accountAuthResponseHeaders({
          action: "login",
          status: "error",
          cardVerification: "not_required",
          session: "not_issued",
          membership: "none",
        }),
      },
    );
  }
}
