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

export type AuthenticatedAccount = {
  id: string;
  email: string | null;
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

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const [scheme, token] = authorization.split(" ");

  if (scheme.toLowerCase() !== "bearer" || !token) return null;

  return token.trim();
}

function isMissingAccountTableError(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    error.message?.toLowerCase().includes("account_auth_events") === true ||
    error.message?.toLowerCase().includes("account_profiles") === true ||
    error.message?.toLowerCase().includes("account_store_memberships") === true
  );
}

function isMissingAccountAuthColumnError(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42703" ||
    message.includes("failure_reason") ||
    message.includes("lockout_until")
  );
}

export async function recordAccountAuthEvent(params: {
  request: Request;
  accountId?: string | null;
  email?: string | null;
  eventType: string;
  success: boolean;
  failureReason?: string | null;
  lockoutUntil?: string | null;
}) {
  const supabase = getSupabaseClient();
  const identity = await getClientIdentity(params.request);

  const payload = {
    account_id: params.accountId ?? null,
    store_id: getActiveStoreId(),
    email: params.email ? cleanEmail(params.email) : null,
    event_type: params.eventType,
    success: params.success,
    failure_reason: params.success ? null : params.failureReason || "failed",
    lockout_until: params.lockoutUntil || null,
    ip_address: identity.ipAddress,
    user_agent: identity.userAgent,
    identity_risk: identity.risk,
    identity_evidence: identity.evidence,
  };

  const { error } = await supabase.from("account_auth_events").insert(payload);

  if (!error) return;

  if (isMissingAccountAuthColumnError(error)) {
    const { failure_reason, lockout_until, ...legacyPayload } = payload;
    void failure_reason;
    void lockout_until;

    const { error: legacyError } = await supabase
      .from("account_auth_events")
      .insert(legacyPayload);

    if (!legacyError || isMissingAccountTableError(legacyError)) return;

    console.error("Account auth event insert failed:", legacyError.message);
    return;
  }

  if (!isMissingAccountTableError(error)) {
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
  const profilePayload: Record<string, unknown> = {
    id: params.accountId,
    email: cleanEmail(params.email),
    display_name: cleanText(params.displayName),
    default_account_type: params.defaultAccountType || "buyer",
    updated_at: new Date().toISOString(),
  };

  if (tosAccepted) {
    profilePayload.tos_accepted = true;
    profilePayload.tos_version = params.tosVersion || TERMS_OF_SERVICE_VERSION;
    profilePayload.tos_accepted_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("account_profiles")
    .upsert(profilePayload, { onConflict: "id" })
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

export async function getAuthenticatedAccountFromRequest(
  request: Request,
): Promise<AuthenticatedAccount | null> {
  const token = bearerToken(request);

  if (!token) return null;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) return null;

  const email =
    typeof data.user.email === "string" && data.user.email.length > 0
      ? data.user.email.toLowerCase()
      : null;

  await createOrUpdateAccountProfile({
    accountId: data.user.id,
    email: email || "",
    displayName:
      typeof data.user.user_metadata?.display_name === "string"
        ? data.user.user_metadata.display_name
        : null,
    defaultAccountType: "buyer",
  });

  await ensureAccountStoreMembership({
    accountId: data.user.id,
    role: "buyer",
  });

  return {
    id: data.user.id,
    email,
  };
}
