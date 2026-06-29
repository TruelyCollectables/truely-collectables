import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getClientIdentity } from "./client-identity";
import { getActiveStoreId } from "./stores";
import { TERMS_OF_SERVICE_VERSION } from "./legal";

export type AccountRole = "buyer" | "seller" | "store_operator" | "platform_admin";

export type AccountProfile = {
  id: string;
  display_name: string | null;
  email: string | null;
  account_status: string;
  default_account_type: string;
  tos_accepted: boolean;
  tos_version: string | null;
  tos_accepted_at: string | null;
  created_at: string;
  updated_at: string;
};

function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
}

function cleanEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function cleanText(value: unknown) {
  const text = String(value || "").trim();
  return text.length > 0 ? text : null;
}

function isMissingAccountTableError(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    error.message?.toLowerCase().includes("account_profiles") === true ||
    error.message?.toLowerCase().includes("account_store_memberships") === true
  );
}

export async function recordAccountAuthEvent(params: {
  request: Request;
  accountId?: string | null;
  email?: string | null;
  eventType: string;
  success: boolean;
}) {
  const supabase = getSupabaseClient();
  const identity = await getClientIdentity(params.request);

  const { error } = await supabase.from("account_auth_events").insert({
    account_id: params.accountId ?? null,
    store_id: getActiveStoreId(),
    email: params.email ? cleanEmail(params.email) : null,
    event_type: params.eventType,
    success: params.success,
    ip_address: identity.ipAddress,
    user_agent: identity.userAgent,
    identity_risk: identity.risk,
    identity_evidence: identity.evidence,
  });

  if (error && !isMissingAccountTableError(error)) {
    console.error("Account auth event insert failed:", error.message);
  }
}

export async function createOrUpdateAccountProfile(params: {
  accountId: string;
  email: string;
  displayName?: string | null;
  defaultAccountType?: "buyer" | "seller";
  tosAccepted?: boolean;
  tosVersion?: string;
}): Promise<AccountProfile | null> {
  const supabase = getSupabaseClient();
  const tosAccepted = params.tosAccepted ?? false;

  const { data, error } = await supabase
    .from("account_profiles")
    .upsert(
      {
        id: params.accountId,
        email: cleanEmail(params.email),
        display_name: cleanText(params.displayName),
        default_account_type: params.defaultAccountType || "buyer",
        tos_accepted: tosAccepted,
        tos_version: tosAccepted
          ? params.tosVersion || TERMS_OF_SERVICE_VERSION
          : null,
        tos_accepted_at: tosAccepted ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    )
    .select("*")
    .single();

  if (error) {
    if (isMissingAccountTableError(error)) return null;
    throw error;
  }

  return data as AccountProfile;
}

export async function ensureAccountStoreMembership(params: {
  accountId: string;
  role: AccountRole;
}) {
  const supabase = getSupabaseClient();

  const { error } = await supabase.from("account_store_memberships").upsert(
    {
      account_id: params.accountId,
      store_id: getActiveStoreId(),
      role: params.role,
      status: "active",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "account_id,store_id,role" },
  );

  if (error) {
    if (isMissingAccountTableError(error)) return;
    throw error;
  }
}
