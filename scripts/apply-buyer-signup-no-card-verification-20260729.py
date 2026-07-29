from pathlib import Path
import re


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    path.write_text(text.replace(old, new, 1))


def regex_once(path: Path, pattern: str, replacement: str, label: str) -> None:
    text = path.read_text()
    updated, count = re.subn(pattern, lambda _: replacement, text, count=1)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    path.write_text(updated)


Path("src/lib/buyer-account-policy.ts").write_text(r'''export const BUYER_CARD_VERIFICATION_REQUIRED = false;
export const BUYER_ACCOUNT_ACTIVE_STATUS = "active";
export const BUYER_MEMBERSHIP_ACTIVE_STATUS = "active";

function normalized(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function isBuyerAccountType(...values: unknown[]) {
  return values.some((value) => normalized(value) === "buyer");
}

export function shouldActivateLegacyBuyerAccount(params: {
  accountStatus?: unknown;
  defaultAccountType?: unknown;
  authAccountType?: unknown;
}) {
  return (
    normalized(params.accountStatus) === "payment_verification_required" &&
    isBuyerAccountType(params.defaultAccountType, params.authAccountType)
  );
}
''')

Path("src/app/account/signup/page.tsx").write_text(r'''"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TERMS_OF_SERVICE_VERSION } from "../../../lib/legal";
import { saveAccountSession } from "../account-session";

export default function AccountSignupPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tosAccepted, setTosAccepted] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/account/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          displayName,
          email,
          password,
          tosAccepted,
          tosVersion: TERMS_OF_SERVICE_VERSION,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || "Account signup failed");
        return;
      }

      if (data.session) {
        saveAccountSession(data.session);
        router.push("/account");
        return;
      }

      setMessage(
        "Buyer account created. Check your email to confirm the account before logging in.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-12">
      <section className="rounded-md border border-neutral-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-bold uppercase text-neutral-500">
          Truely Collectables Buyer Account
        </p>
        <h1 className="mt-2 text-3xl font-black">Create Buyer Account</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          Create an account with your email and password to track purchases and
          manage your collection. No payment card is required to register. Payment
          details are entered only when you place an order.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-bold text-neutral-700">Display Name</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-3"
              placeholder="Collector name"
            />
          </label>

          <label className="block">
            <span className="text-sm font-bold text-neutral-700">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-3"
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-bold text-neutral-700">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-3"
              placeholder="At least 10 characters"
              autoComplete="new-password"
              required
              minLength={10}
            />
          </label>

          <label className="flex items-start gap-3 rounded border border-neutral-200 bg-neutral-50 p-3 text-sm leading-6">
            <input
              type="checkbox"
              checked={tosAccepted}
              onChange={(event) => setTosAccepted(event.target.checked)}
              className="mt-1 h-4 w-4"
              required
            />
            <span>
              I accept the{" "}
              <Link href="/terms" className="font-bold underline">
                Terms of Service
              </Link>
              .
            </span>
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded bg-neutral-950 px-4 py-3 font-bold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-500"
          >
            {isSubmitting ? "Creating..." : "Create Buyer Account"}
          </button>
        </form>

        <p className="mt-3 text-xs leading-5 text-neutral-500">
          Buyer registration does not create a TCOS seller account. Seller
          onboarding and its verification requirements remain separate.
        </p>

        {error ? (
          <p className="mt-4 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">
            {error}
          </p>
        ) : null}

        {message ? (
          <p className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
            {message}
          </p>
        ) : null}

        <p className="mt-5 text-sm text-neutral-600">
          Already have an account?{" "}
          <Link href="/account/login" className="font-bold underline">
            Log in
          </Link>
        </p>
      </section>
    </main>
  );
}
''')

Path("src/app/account/login/page.tsx").write_text(r'''"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveAccountSession } from "../account-session";

export default function AccountLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/account/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.session) {
        setError(data.error || "Account login failed");
        return;
      }

      saveAccountSession(data.session);
      router.push("/account");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-12">
      <section className="rounded-md border border-neutral-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-bold uppercase text-neutral-500">
          Truely Collectables Buyer Account
        </p>
        <h1 className="mt-2 text-3xl font-black">Buyer Account Login</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          Log in to view linked orders and manage your buyer account. No card
          verification is required. TCOS seller and admin access remain separate.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-bold text-neutral-700">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-3"
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-bold text-neutral-700">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-3"
              placeholder="Password"
              autoComplete="current-password"
              required
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded bg-neutral-950 px-4 py-3 font-bold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-500"
          >
            {isSubmitting ? "Checking..." : "Log In"}
          </button>
        </form>

        {error ? (
          <p className="mt-4 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">
            {error}
          </p>
        ) : null}

        <p className="mt-5 text-sm text-neutral-600">
          Need an account?{" "}
          <Link href="/account/signup" className="font-bold underline">
            Create one
          </Link>
        </p>
      </section>
    </main>
  );
}
''')

Path("src/app/api/account/signup/route.ts").write_text(r'''import { NextResponse } from "next/server";
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
    email = String(body.email || "").trim().toLowerCase();
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
        { error: "Terms of Service must be accepted before creating an account" },
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
''')

Path("src/app/api/account/login/route.ts").write_text(r'''import { NextResponse } from "next/server";
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
    email = String(body.email || "").trim().toLowerCase();
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
      defaultAccountType: "buyer",
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
''')

account_auth = Path("src/lib/account-auth.ts")
replace_once(
    account_auth,
    'import { getClientIdentity } from "./client-identity";\n',
    'import { getClientIdentity } from "./client-identity";\nimport {\n  BUYER_ACCOUNT_ACTIVE_STATUS,\n  BUYER_MEMBERSHIP_ACTIVE_STATUS,\n  shouldActivateLegacyBuyerAccount,\n} from "./buyer-account-policy";\n',
    "account auth policy import",
)
replace_once(
    account_auth,
    '''  const profile = await createOrUpdateAccountProfile({
    accountId: data.user.id,
    email: email || "",
    displayName:
      typeof data.user.user_metadata?.display_name === "string"
        ? data.user.user_metadata.display_name
        : null,
    defaultAccountType: "buyer",
  });

  const accountStatus = profile?.account_status || "active";

  if (accountStatus !== "active") return null;

  await ensureAccountStoreMembership({
    accountId: data.user.id,
    role: "buyer",
  });''',
    '''  const authAccountType = data.user.user_metadata?.tcos_account_type;
    let profile = await createOrUpdateAccountProfile({
      accountId: data.user.id,
      email: email || "",
      displayName:
        typeof data.user.user_metadata?.display_name === "string"
          ? data.user.user_metadata.display_name
          : null,
      defaultAccountType: "buyer",
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
        email: email || "",
        displayName: profile?.display_name || null,
        defaultAccountType: "buyer",
        accountStatus: BUYER_ACCOUNT_ACTIVE_STATUS,
        cardVerified: false,
        cardVerifiedAt: null,
      });
    }

    const accountStatus = profile?.account_status || BUYER_ACCOUNT_ACTIVE_STATUS;

    if (accountStatus !== BUYER_ACCOUNT_ACTIVE_STATUS) return null;

    await ensureAccountStoreMembership({
      accountId: data.user.id,
      role: "buyer",
      status: BUYER_MEMBERSHIP_ACTIVE_STATUS,
    });''',
    "authenticated buyer migration",
)

webhook = Path("src/app/api/webhook/route.ts")
webhook_handler = r'''async function handleAccountCardVerification(params: {
  supabase: SupabaseClient;
  stripe: Stripe;
  session: Stripe.Checkout.Session;
  storeId: string;
}) {
  const { supabase, stripe, session, storeId } = params;
  const metadata = session.metadata || {};
  const accountId = metadata.account_id;

  if (!accountId) {
    throw new Error("Account card verification metadata is incomplete");
  }

  const { data: profile, error: profileLookupError } = await supabase
    .from("account_profiles")
    .select("default_account_type")
    .eq("id", accountId)
    .maybeSingle();
  if (profileLookupError) throw profileLookupError;

  const checkedAt = new Date().toISOString();
  const sellerVerification =
    String(profile?.default_account_type || "").toLowerCase() === "seller";

  if (!sellerVerification) {
    const { error: buyerProfileError } = await supabase
      .from("account_profiles")
      .update({
        account_status: "active",
        card_verified: false,
        card_verified_at: null,
        stripe_setup_intent_id: null,
        stripe_payment_method_id: null,
        card_verification_failure_reason: null,
        card_verification_checked_at: checkedAt,
        updated_at: checkedAt,
      })
      .eq("id", accountId);
    if (buyerProfileError) throw buyerProfileError;

    const { error: buyerMembershipError } = await supabase
      .from("account_store_memberships")
      .upsert(
        {
          account_id: accountId,
          store_id: storeId,
          role: "buyer",
          status: "active",
          updated_at: checkedAt,
        },
        { onConflict: "account_id,store_id,role" },
      );
    if (buyerMembershipError) throw buyerMembershipError;

    return "buyer_card_verification_retired";
  }

  const setupIntentId =
    typeof session.setup_intent === "string" ? session.setup_intent : null;
  const setupIntent = setupIntentId
    ? await stripe.setupIntents.retrieve(setupIntentId)
    : null;
  const paymentMethodId =
    typeof setupIntent?.payment_method === "string"
      ? setupIntent.payment_method
      : null;
  const paymentMethod = paymentMethodId
    ? await stripe.paymentMethods.retrieve(paymentMethodId)
    : null;
  const cardEvidence = evaluateAccountCardVerification(paymentMethod);
  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : typeof paymentMethod?.customer === "string"
        ? paymentMethod.customer
        : null;

  if (!paymentMethodId) {
    throw new Error("Seller card verification payment method is missing");
  }

  const accountStatus = cardEvidence.allowed
    ? "active"
    : "payment_verification_required";
  const { error: profileError } = await supabase
    .from("account_profiles")
    .update({
      account_status: accountStatus,
      card_verified: cardEvidence.allowed,
      card_verified_at: cardEvidence.allowed ? checkedAt : null,
      stripe_customer_id: customerId,
      stripe_setup_intent_id: setupIntentId,
      stripe_payment_method_id: paymentMethodId,
      card_brand: cardEvidence.cardBrand,
      card_last4: cardEvidence.cardLast4,
      card_exp_month: cardEvidence.cardExpMonth,
      card_exp_year: cardEvidence.cardExpYear,
      card_funding: cardEvidence.cardFunding,
      billing_name: cardEvidence.billingName,
      billing_line1: cardEvidence.billingLine1,
      billing_line2: cardEvidence.billingLine2,
      billing_city: cardEvidence.billingCity,
      billing_state: cardEvidence.billingState,
      billing_country: cardEvidence.billingCountry,
      billing_postal_code: cardEvidence.billingPostalCode,
      card_verification_failure_reason: cardEvidence.failureReason,
      card_verification_checked_at: checkedAt,
      updated_at: checkedAt,
    })
    .eq("id", accountId);
  if (profileError) throw profileError;

  const { error: membershipError } = await supabase
    .from("account_store_memberships")
    .upsert(
      {
        account_id: accountId,
        store_id: storeId,
        role: "seller",
        status: accountStatus,
        updated_at: checkedAt,
      },
      { onConflict: "account_id,store_id,role" },
    );
  if (membershipError) throw membershipError;

  return "seller_card_verification_updated";
}

async function handleBindingOfferSetup'''
regex_once(
    webhook,
    r"async function handleAccountCardVerification\([\s\S]*?\n}\n\nasync function handleBindingOfferSetup",
    webhook_handler,
    "seller-only card verification handler",
)
replace_once(
    webhook,
    '''    if (metadata.type === "account_card_verification_setup") {
      await handleAccountCardVerification({
        supabase,
        stripe,
        session,
        storeId,
      });
      await finishStripeWebhookEvent({
        ...journal,
        status: "processed",
        metadata: { outcome: "account_card_verification_updated" },
      });
      return NextResponse.json({ received: true });
    }''',
    '''    if (
      metadata.type === "account_card_verification_setup" ||
      metadata.type === "seller_card_verification_setup"
    ) {
      const outcome = await handleAccountCardVerification({
        supabase,
        stripe,
        session,
        storeId,
      });
      await finishStripeWebhookEvent({
        ...journal,
        status: "processed",
        metadata: { outcome },
      });
      return NextResponse.json({ received: true });
    }''',
    "verification webhook dispatch",
)

Path("scripts/run-buyer-account-no-card-regressions.ts").write_text(r'''import assert from "node:assert/strict";
import fs from "node:fs";
import {
  BUYER_ACCOUNT_ACTIVE_STATUS,
  BUYER_CARD_VERIFICATION_REQUIRED,
  BUYER_MEMBERSHIP_ACTIVE_STATUS,
  shouldActivateLegacyBuyerAccount,
} from "../src/lib/buyer-account-policy";

const read = (path: string) => fs.readFileSync(path, "utf8");
const signupPage = read("src/app/account/signup/page.tsx");
const loginPage = read("src/app/account/login/page.tsx");
const signupRoute = read("src/app/api/account/signup/route.ts");
const loginRoute = read("src/app/api/account/login/route.ts");
const accountAuth = read("src/lib/account-auth.ts");
const checkoutRoute = read("src/app/api/checkout/route.ts");
const webhookRoute = read("src/app/api/webhook/route.ts");

assert.equal(BUYER_CARD_VERIFICATION_REQUIRED, false);
assert.equal(BUYER_ACCOUNT_ACTIVE_STATUS, "active");
assert.equal(BUYER_MEMBERSHIP_ACTIVE_STATUS, "active");
assert.equal(
  shouldActivateLegacyBuyerAccount({
    accountStatus: "payment_verification_required",
    defaultAccountType: "buyer",
  }),
  true,
);
assert.equal(
  shouldActivateLegacyBuyerAccount({
    accountStatus: "payment_verification_required",
    defaultAccountType: "seller",
  }),
  false,
);
assert.equal(
  shouldActivateLegacyBuyerAccount({
    accountStatus: "active",
    defaultAccountType: "buyer",
  }),
  false,
);

assert.match(signupPage, /Truely Collectables Buyer Account/);
assert.match(signupPage, /No payment card is required to register/);
assert.match(signupPage, /Create Buyer Account/);
assert.doesNotMatch(signupPage, /Create Account And Verify Card/);
assert.doesNotMatch(signupPage, /cardVerificationUrl/);
assert.doesNotMatch(signupPage, /card_verification=canceled/);
assert.match(loginPage, /No card verification is required/);
assert.doesNotMatch(loginPage, /Stripe confirms the card/);

assert.doesNotMatch(signupRoute, /from "stripe"/);
assert.doesNotMatch(signupRoute, /getStripePaymentRuntime/);
assert.doesNotMatch(signupRoute, /checkout\.sessions\.create/);
assert.doesNotMatch(signupRoute, /ACCOUNT_CARD_VERIFICATION_REQUIRED/);
assert.match(signupRoute, /accountStatus: BUYER_ACCOUNT_ACTIVE_STATUS/);
assert.match(signupRoute, /status: BUYER_MEMBERSHIP_ACTIVE_STATUS/);
assert.match(signupRoute, /cardVerificationRequired: BUYER_CARD_VERIFICATION_REQUIRED/);
assert.match(signupRoute, /session: data\.session/);

assert.match(loginRoute, /shouldActivateLegacyBuyerAccount/);
assert.match(loginRoute, /buyer_card_verification_requirement_removed/);
assert.match(loginRoute, /Seller verification must be completed through TCOS seller onboarding/);
assert.match(accountAuth, /shouldActivateLegacyBuyerAccount/);
assert.match(accountAuth, /status: BUYER_MEMBERSHIP_ACTIVE_STATUS/);

assert.match(checkoutRoute, /const account = await getAuthenticatedAccountFromRequest/);
assert.match(checkoutRoute, /accountId: account\?\.id \|\| null/);
assert.doesNotMatch(checkoutRoute, /payment_verification_required/);
assert.doesNotMatch(checkoutRoute, /card_verified/);

assert.match(webhookRoute, /seller_card_verification_setup/);
assert.match(webhookRoute, /role: "seller"/);
assert.match(webhookRoute, /buyer_card_verification_retired/);
assert.match(webhookRoute, /role: "buyer"[\s\S]*status: "active"/);
assert.match(webhookRoute, /evaluateAccountCardVerification/);

console.log("Buyer account signup without card verification regressions passed.");
''')

print("Buyer account no-card-verification patch applied.")
