import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getClientIdentity, type ClientIdentity } from "./client-identity";
import { getActiveStoreId } from "./stores";

const LOGIN_WINDOW_MINUTES = 15;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

type LoginAttemptRow = {
  success: boolean;
  lockout_until: string | null;
  created_at: string;
};

export type AdminLoginSecurityCheck = {
  allowed: boolean;
  auditAvailable: boolean;
  identity: ClientIdentity;
  failedAttempts: number;
  maxFailedAttempts: number;
  lockoutUntil: string | null;
  retryAfterSeconds: number | null;
  reason: string | null;
};

function getSupabaseClient(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) return null;

  return createClient(supabaseUrl, supabaseKey);
}

function windowStart() {
  return new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60 * 1000).toISOString();
}

function futureIso(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function secondsUntil(value: string | null) {
  if (!value) return null;

  const timestamp = new Date(value).getTime();
  const seconds = Math.ceil((timestamp - Date.now()) / 1000);

  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function clientKey(identity: ClientIdentity) {
  return identity.ipAddress || "unknown";
}

function isMissingTableError(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    error.message?.toLowerCase().includes("admin_login_attempts") === true
  );
}

export async function checkAdminLoginAllowed(
  request: Request,
): Promise<AdminLoginSecurityCheck> {
  const identity = await getClientIdentity(request);
  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();

  if (identity.blocked) {
    return {
      allowed: false,
      auditAvailable: Boolean(supabase),
      identity,
      failedAttempts: MAX_FAILED_ATTEMPTS,
      maxFailedAttempts: MAX_FAILED_ATTEMPTS,
      lockoutUntil: null,
      retryAfterSeconds: null,
      reason: identity.blockReason || "blocked_identity",
    };
  }

  if (!supabase) {
    return {
      allowed: true,
      auditAvailable: false,
      identity,
      failedAttempts: 0,
      maxFailedAttempts: MAX_FAILED_ATTEMPTS,
      lockoutUntil: null,
      retryAfterSeconds: null,
      reason: null,
    };
  }

  const { data, error } = await supabase
    .from("admin_login_attempts")
    .select("success,lockout_until,created_at")
    .eq("store_id", storeId)
    .eq("ip_address", clientKey(identity))
    .gte("created_at", windowStart())
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) {
    if (isMissingTableError(error)) {
      return {
        allowed: true,
        auditAvailable: false,
        identity,
        failedAttempts: 0,
        maxFailedAttempts: MAX_FAILED_ATTEMPTS,
        lockoutUntil: null,
        retryAfterSeconds: null,
        reason: null,
      };
    }

    throw error;
  }

  const rows = (data ?? []) as LoginAttemptRow[];
  const activeLockout = rows
    .map((row) => row.lockout_until)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
  const retryAfterSeconds = secondsUntil(activeLockout);
  const failedAttempts = rows.filter((row) => !row.success).length;

  if (retryAfterSeconds) {
    return {
      allowed: false,
      auditAvailable: true,
      identity,
      failedAttempts,
      maxFailedAttempts: MAX_FAILED_ATTEMPTS,
      lockoutUntil: activeLockout,
      retryAfterSeconds,
      reason: "locked_out",
    };
  }

  if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
    const lockoutUntil = futureIso(LOCKOUT_MINUTES);

    return {
      allowed: false,
      auditAvailable: true,
      identity,
      failedAttempts,
      maxFailedAttempts: MAX_FAILED_ATTEMPTS,
      lockoutUntil,
      retryAfterSeconds: secondsUntil(lockoutUntil),
      reason: "too_many_failed_attempts",
    };
  }

  return {
    allowed: true,
    auditAvailable: true,
    identity,
    failedAttempts,
    maxFailedAttempts: MAX_FAILED_ATTEMPTS,
    lockoutUntil: null,
    retryAfterSeconds: null,
    reason: null,
  };
}

export async function recordAdminLoginAttempt(params: {
  check: AdminLoginSecurityCheck;
  success: boolean;
  failureReason?: string | null;
}) {
  const supabase = getSupabaseClient();

  if (!supabase || !params.check.auditAvailable) return;

  const failedAttemptsAfterThis =
    params.success ? 0 : params.check.failedAttempts + 1;
  const shouldLock =
    !params.success && failedAttemptsAfterThis >= MAX_FAILED_ATTEMPTS;
  const lockoutUntil =
    params.check.lockoutUntil || (shouldLock ? futureIso(LOCKOUT_MINUTES) : null);

  const { error } = await supabase.from("admin_login_attempts").insert({
    store_id: getActiveStoreId(),
    ip_address: clientKey(params.check.identity),
    user_agent: params.check.identity.userAgent,
    success: params.success,
    failure_reason: params.success ? null : params.failureReason || "failed",
    lockout_until: lockoutUntil,
    identity_risk: params.check.identity.risk,
    identity_evidence: params.check.identity.evidence,
  });

  if (error && !isMissingTableError(error)) {
    console.error("Admin login audit insert failed:", error.message);
  }
}

export const adminLoginSecurityPolicy = {
  loginWindowMinutes: LOGIN_WINDOW_MINUTES,
  maxFailedAttempts: MAX_FAILED_ATTEMPTS,
  lockoutMinutes: LOCKOUT_MINUTES,
};
