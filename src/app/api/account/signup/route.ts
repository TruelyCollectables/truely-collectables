import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

export const dynamic = "force-dynamic";

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
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

    await createOrUpdateAccountProfile({
      accountId: data.user.id,
      email,
      displayName,
      defaultAccountType: "buyer",
      tosAccepted,
      tosVersion,
    });

    await ensureAccountStoreMembership({
      accountId: data.user.id,
      role: "buyer",
    });

    await recordAccountAuthEvent({
      request,
      accountId: data.user.id,
      email,
      eventType: "signup",
      success: true,
    });

    return NextResponse.json({
      success: true,
      userId: data.user.id,
      email,
      emailConfirmationRequired: !data.session,
      session: data.session,
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
