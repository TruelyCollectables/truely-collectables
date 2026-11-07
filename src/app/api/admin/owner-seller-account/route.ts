import { NextResponse } from "next/server";
import {
  createOrUpdateAccountProfile,
  ensureAccountStoreMembership,
} from "../../../../lib/account-auth";
import {
  ADMIN_SESSION_COOKIE_NAMES,
  isValidAdminSessionValue,
} from "../../../../lib/admin-session";
import { SELLER_TERMS_OF_SERVICE_VERSION } from "../../../../lib/legal";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

const OWNER_EMAIL = "sales@truelycollectables.com";

function cookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") || "";

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;

    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return undefined;
}

async function requireAdmin(request: Request) {
  for (const cookieName of ADMIN_SESSION_COOKIE_NAMES) {
    if (await isValidAdminSessionValue(cookieValue(request, cookieName))) {
      return true;
    }
  }

  return false;
}

export async function POST(request: Request) {
  try {
    if (!(await requireAdmin(request))) {
      return NextResponse.json(
        { error: "Log in through the TCOS admin first." },
        { status: 401 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const password = String(body.password || "");
    const confirmPassword = String(body.confirmPassword || "");

    if (password.length < 12) {
      return NextResponse.json(
        { error: "Use a password with at least 12 characters." },
        { status: 400 },
      );
    }

    if (password !== confirmPassword) {
      return NextResponse.json(
        { error: "The two passwords do not match." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    let accountId: string | null = null;
    let mode: "created" | "repaired" = "created";

    const { data: profile, error: profileError } = await supabase
      .from("account_profiles")
      .select("id")
      .eq("email", OWNER_EMAIL)
      .maybeSingle();

    if (profileError) throw profileError;
    if (profile?.id) {
      accountId = String(profile.id);
      mode = "repaired";
    }

    if (!accountId) {
      const { data: usersData, error: usersError } =
        await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (usersError) throw usersError;

      const existingUser = usersData.users.find(
        (user) => user.email?.trim().toLowerCase() === OWNER_EMAIL,
      );

      if (existingUser) {
        accountId = existingUser.id;
        mode = "repaired";
      }
    }

    if (accountId) {
      const { error: updateError } = await supabase.auth.admin.updateUserById(
        accountId,
        {
          email: OWNER_EMAIL,
          password,
          email_confirm: true,
          user_metadata: {
            display_name: "Truely Collectables",
            tcos_account_type: "seller_owner",
            owner_store_account: true,
          },
        },
      );
      if (updateError) throw updateError;
    } else {
      const { data: created, error: createError } =
        await supabase.auth.admin.createUser({
          email: OWNER_EMAIL,
          password,
          email_confirm: true,
          user_metadata: {
            display_name: "Truely Collectables",
            tcos_account_type: "seller_owner",
            owner_store_account: true,
          },
        });
      if (createError || !created.user) {
        throw createError || new Error("Owner seller account was not created.");
      }
      accountId = created.user.id;
    }

    const verifiedAt = new Date().toISOString();
    await createOrUpdateAccountProfile({
      accountId,
      email: OWNER_EMAIL,
      displayName: "Truely Collectables",
      defaultAccountType: "seller",
      accountStatus: "active",
      tosAccepted: true,
      cardVerified: true,
      cardVerifiedAt: verifiedAt,
    });

    await Promise.all([
      ensureAccountStoreMembership({
        accountId,
        role: "buyer",
        status: "active",
      }),
      ensureAccountStoreMembership({
        accountId,
        role: "seller",
        status: "active",
      }),
      ensureAccountStoreMembership({
        accountId,
        role: "store_operator",
        status: "active",
      }),
    ]);

    const { error: payoutError } = await supabase
      .from("seller_payout_accounts")
      .upsert(
        {
          account_id: accountId,
          store_id: storeId,
          provider: "stripe_connect",
          provider_account_id: `platform_store_owner:${storeId}`,
          onboarding_status: "active",
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          seller_tos_accepted: true,
          seller_tos_version: SELLER_TERMS_OF_SERVICE_VERSION,
          seller_tos_accepted_at: verifiedAt,
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
          updated_at: verifiedAt,
        },
        { onConflict: "store_id,account_id,provider" },
      );

    if (payoutError) throw payoutError;

    return NextResponse.json({
      success: true,
      email: OWNER_EMAIL,
      mode,
      payoutMode: "platform_store_owner",
      connectRequired: false,
      loginUrl: "/account/login",
      sellerUrl: "/seller",
    });
  } catch (error: any) {
    console.error("Owner seller account bootstrap failed:", error);
    return NextResponse.json(
      {
        error:
          error?.message || "The owner seller account could not be activated.",
      },
      { status: 500 },
    );
  }
}
