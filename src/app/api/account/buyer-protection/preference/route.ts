import { NextResponse } from "next/server";
import { getAuthenticatedAccountFromRequest } from "../../../../../lib/account-auth";
import {
  BUYER_PROTECTION_POLICY_VERSION,
  isBuyerProtectionPreferenceMode,
} from "../../../../../lib/buyer-protection";
import {
  getBuyerProtectionPreference,
  isCurrentAlwaysOnPreference,
} from "../../../../../lib/buyer-protection-server";
import { getClientIdentity } from "../../../../../lib/client-identity";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const preference = await getBuyerProtectionPreference({
      supabase,
      storeId,
      accountId: account.id,
    });

    return NextResponse.json({
      success: true,
      currentPolicyVersion: BUYER_PROTECTION_POLICY_VERSION,
      preference,
      currentAlwaysOn: isCurrentAlwaysOnPreference(preference),
      requiresReacceptance:
        preference?.mode === "always_on" &&
        preference.policy_version !== BUYER_PROTECTION_POLICY_VERSION,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not load Buyer Protection preference" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const mode = body.mode;
    if (!isBuyerProtectionPreferenceMode(mode) || mode === "one_time") {
      return NextResponse.json(
        { error: "Preference must be Always On or Always Off" },
        { status: 400 },
      );
    }

    const identity = await getClientIdentity(request);
    if (identity.blocked) {
      return NextResponse.json(
        { error: "Buyer Protection preference could not be verified" },
        { status: 403 },
      );
    }

    if (
      mode === "always_on" &&
      (body.policyVersion !== BUYER_PROTECTION_POLICY_VERSION ||
        body.termsAccepted !== true)
    ) {
      return NextResponse.json(
        { error: "The current Buyer Protection terms must be accepted" },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("account_buyer_protection_preferences")
      .upsert(
        {
          store_id: storeId,
          account_id: account.id,
          mode,
          policy_version:
            mode === "always_on" ? BUYER_PROTECTION_POLICY_VERSION : null,
          terms_accepted_at: mode === "always_on" ? now : null,
          opted_out_at: mode === "always_off" ? now : null,
          acceptance_ip_address:
            mode === "always_on" ? identity.ipAddress : null,
          acceptance_user_agent:
            mode === "always_on" ? identity.userAgent : null,
          acceptance_ip_risk: mode === "always_on" ? identity.risk : null,
          acceptance_ip_block_reason:
            mode === "always_on" ? identity.blockReason : null,
          acceptance_ip_evidence:
            mode === "always_on" ? identity.evidence : {},
          updated_at: now,
        },
        { onConflict: "store_id,account_id" },
      );

    if (error) throw error;

    return NextResponse.json({
      success: true,
      mode,
      policyVersion:
        mode === "always_on" ? BUYER_PROTECTION_POLICY_VERSION : null,
      termsAcceptedAt: mode === "always_on" ? now : null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not save Buyer Protection preference" },
      { status: 500 },
    );
  }
}
