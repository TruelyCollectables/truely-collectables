import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getClientIdentity, type ClientIdentity } from "./client-identity";
import { getActiveStoreId } from "./stores";

const ACCOUNT_AUTH_WINDOW_MINUTES = 15;
const MAX_FAILED_ACCOUNT_ATTEMPTS = 6;
const ACCOUNT_LOCKOUT_MINUTES = 15;

type AccountAuthEventRow = {
  id: string;
  success: boolean;
  lockout_until: string | null;
  created_at: string;
};

export type AccountAuthSecurityCheck = {
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

function cleanEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function windowStart() {
  return new Date(Date.now() - ACCOUNT_AUTH_WINDOW_MINUTES * 60 * 1000).toISOString();
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

function isMissingAuthEventCapability(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("account_auth_events") ||
    message.includes("lockout_until")
  );
}

function mergeRows(rowSets: AccountAuthEventRow[][]) {
  const rowsById = new Map<string, AccountAuthEventRow>();

  for (const rows of rowSets) {
    for (const row of rows) {
      rowsById.set(row.id, row);
    }
  }

  return Array.from(rowsById.values());
}

export async function checkAccountAuthAllowed(params: {
  request: Request;
  email?: string | null;
  eventType: "login" | "signup";
}): Promise<AccountAuthSecurityCheck> {
  const identity = await getClientIdentity(params.request);
  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();
  const email = cleanEmail(params.email);

  if (identity.blocked) {
    return {
      allowed: false,
      auditAvailable: Boolean(supabase),
      identity,
      failedAttempts: MAX_FAILED_ACCOUNT_ATTEMPTS,
      maxFailedAttempts: MAX_FAILED_ACCOUNT_ATTEMPTS,
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
      maxFailedAttempts: MAX_FAILED_ACCOUNT_ATTEMPTS,
      lockoutUntil: null,
      retryAfterSeconds: null,
      reason: null,
    };
  }

  const baseSelect = "id,success,lockout_until,created_at";
  const ipQuery = supabase
    .from("account_auth_events")
    .select(baseSelect)
    .eq("store_id", storeId)
    .eq("event_type", params.eventType)
    .eq("ip_address", clientKey(identity))
    .gte("created_at", windowStart())
    .order("created_at", { ascending: false })
    .limit(50);

  const emailQuery = email
    ? supabase
        .from("account_auth_events")
        .select(baseSelect)
        .eq("store_id", storeId)
        .eq("event_type", params.eventType)
        .eq("email", email)
        .gte("created_at", windowStart())
        .order("created_at", { ascending: false })
        .limit(50)
    : null;

  const [ipResult, emailResult] = await Promise.all([
    ipQuery,
    emailQuery ?? Promise.resolve({ data: [], error: null }),
  ]);

  if (ipResult.error || emailResult.error) {
    const error = ipResult.error || emailResult.error;

    if (error && isMissingAuthEventCapability(error)) {
      return {
        allowed: true,
        auditAvailable: false,
        identity,
        failedAttempts: 0,
        maxFailedAttempts: MAX_FAILED_ACCOUNT_ATTEMPTS,
        lockoutUntil: null,
        retryAfterSeconds: null,
        reason: null,
      };
    }

    throw error;
  }

  const rows = mergeRows([
    (ipResult.data ?? []) as AccountAuthEventRow[],
    (emailResult.data ?? []) as AccountAuthEventRow[],
  ]);
  const activeLockout =
    rows
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
      maxFailedAttempts: MAX_FAILED_ACCOUNT_ATTEMPTS,
      lockoutUntil: activeLockout,
      retryAfterSeconds,
      reason: "locked_out",
    };
  }

  if (failedAttempts >= MAX_FAILED_ACCOUNT_ATTEMPTS) {
    const lockoutUntil = futureIso(ACCOUNT_LOCKOUT_MINUTES);

    return {
      allowed: false,
      auditAvailable: true,
      identity,
      failedAttempts,
      maxFailedAttempts: MAX_FAILED_ACCOUNT_ATTEMPTS,
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
    maxFailedAttempts: MAX_FAILED_ACCOUNT_ATTEMPTS,
    lockoutUntil: null,
    retryAfterSeconds: null,
    reason: null,
  };
}

export function accountAuthBlockedResponse(check: AccountAuthSecurityCheck) {
  if (check.reason === "locked_out" || check.reason === "too_many_failed_attempts") {
    const minutes = Math.max(1, Math.ceil((check.retryAfterSeconds || 60) / 60));

    return {
      status: 429,
      error: `Too many account attempts. Try again in ${minutes} minute${
        minutes === 1 ? "" : "s"
      }.`,
    };
  }

  return {
    status: 403,
    error: "Sorry, you must turn off your proxy or VPN to use this website.",
  };
}

export const accountAuthSecurityPolicy = {
  accountAuthWindowMinutes: ACCOUNT_AUTH_WINDOW_MINUTES,
  maxFailedAccountAttempts: MAX_FAILED_ACCOUNT_ATTEMPTS,
  accountLockoutMinutes: ACCOUNT_LOCKOUT_MINUTES,
};
