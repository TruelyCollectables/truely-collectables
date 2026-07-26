import type { SupabaseClient } from "@supabase/supabase-js";
import { getClientIdentity, type ClientIdentity } from "./client-identity";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

type RateLimitEventRow = {
  id: string;
  created_at: string;
};

export type PublicEndpointRateLimitCheck = {
  allowed: boolean;
  auditAvailable: boolean;
  identity: ClientIdentity;
  retryAfterSeconds: number | null;
  attemptsInWindow: number;
  maxAttempts: number;
  windowSeconds: number;
  reason: string | null;
};

function getSupabaseClient(): SupabaseClient | null {
  try {
    return createSupabaseServerClient({ admin: true });
  } catch {
    return null;
  }
}

function windowStart(windowSeconds: number) {
  return new Date(Date.now() - windowSeconds * 1000).toISOString();
}

function secondsUntilWindowClears(rows: RateLimitEventRow[], windowSeconds: number) {
  const oldestTimestamp = rows
    .map((row) => new Date(row.created_at).getTime())
    .filter(Number.isFinite)
    .sort((left, right) => left - right)[0];

  if (!oldestTimestamp) return windowSeconds;

  const clearsAt = oldestTimestamp + windowSeconds * 1000;
  const seconds = Math.ceil((clearsAt - Date.now()) / 1000);

  return Number.isFinite(seconds) && seconds > 0 ? seconds : windowSeconds;
}

function cleanKey(value: unknown, maxLength = 180) {
  const text = String(value || "").trim().toLowerCase();

  return text ? text.slice(0, maxLength) : null;
}

function isMissingRateLimitCapability(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("public_endpoint_rate_limit_events")
  );
}

function unavailableRateLimitCheck(params: {
  identity: ClientIdentity;
  maxAttempts: number;
  windowSeconds: number;
}): PublicEndpointRateLimitCheck {
  return {
    allowed: false,
    auditAvailable: false,
    identity: params.identity,
    retryAfterSeconds: 30,
    attemptsInWindow: 0,
    maxAttempts: params.maxAttempts,
    windowSeconds: params.windowSeconds,
    reason: "rate_limit_unavailable",
  };
}

async function recordRateLimitEvent(params: {
  supabase: SupabaseClient;
  storeId: string;
  endpointKey: string;
  subjectKey: string | null;
  identity: ClientIdentity;
  blocked: boolean;
  blockReason: string | null;
  windowSeconds: number;
  maxAttempts: number;
}) {
  try {
    const { error } = await params.supabase
      .from("public_endpoint_rate_limit_events")
      .insert({
        store_id: params.storeId,
        endpoint_key: params.endpointKey,
        subject_key: params.subjectKey,
        ip_address: params.identity.ipAddress || "unknown",
        user_agent: params.identity.userAgent,
        blocked: params.blocked,
        block_reason: params.blockReason,
        window_seconds: params.windowSeconds,
        max_attempts: params.maxAttempts,
        identity_risk: params.identity.risk,
        identity_evidence: params.identity.evidence,
      });

    if (error) {
      if (!isMissingRateLimitCapability(error)) {
        console.error(
          "Public endpoint rate-limit audit insert failed:",
          error.message,
        );
      }
      return false;
    }

    return true;
  } catch (error) {
    console.error(
      "Public endpoint rate-limit audit insert failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return false;
  }
}

export async function checkPublicEndpointRateLimit(params: {
  request: Request;
  endpointKey: string;
  maxAttempts: number;
  windowSeconds: number;
  subjectKey?: string | null;
  supabase?: SupabaseClient | null;
  failClosed?: boolean;
}): Promise<PublicEndpointRateLimitCheck> {
  const identity = await getClientIdentity(params.request);
  const supabase = Object.prototype.hasOwnProperty.call(params, "supabase")
    ? params.supabase ?? null
    : getSupabaseClient();
  const failClosed =
    typeof params.failClosed === "boolean"
      ? params.failClosed
      : process.env.NODE_ENV === "production";
  const storeId = getActiveStoreId();
  const endpointKey = cleanKey(params.endpointKey, 120) || "unknown";
  const subjectKey = cleanKey(params.subjectKey);

  if (identity.blocked) {
    const auditAvailable = supabase
      ? await recordRateLimitEvent({
          supabase,
          storeId,
          endpointKey,
          subjectKey,
          identity,
          blocked: true,
          blockReason: identity.blockReason || "blocked_identity",
          windowSeconds: params.windowSeconds,
          maxAttempts: params.maxAttempts,
        })
      : false;

    return {
      allowed: false,
      auditAvailable,
      identity,
      retryAfterSeconds: null,
      attemptsInWindow: params.maxAttempts,
      maxAttempts: params.maxAttempts,
      windowSeconds: params.windowSeconds,
      reason: identity.blockReason || "blocked_identity",
    };
  }

  if (!supabase) {
    return failClosed
      ? unavailableRateLimitCheck({
          identity,
          maxAttempts: params.maxAttempts,
          windowSeconds: params.windowSeconds,
        })
      : {
          allowed: true,
          auditAvailable: false,
          identity,
          retryAfterSeconds: null,
          attemptsInWindow: 0,
          maxAttempts: params.maxAttempts,
          windowSeconds: params.windowSeconds,
          reason: null,
        };
  }

  let query = supabase
    .from("public_endpoint_rate_limit_events")
    .select("id,created_at")
    .eq("store_id", storeId)
    .eq("endpoint_key", endpointKey)
    .eq("ip_address", identity.ipAddress || "unknown")
    .gte("created_at", windowStart(params.windowSeconds))
    .order("created_at", { ascending: false })
    .limit(params.maxAttempts + 5);

  if (subjectKey) {
    query = query.eq("subject_key", subjectKey);
  }

  const { data, error } = await query;

  if (error) {
    if (!isMissingRateLimitCapability(error)) {
      console.error("Public endpoint rate-limit query failed:", error.message);
    }

    if (failClosed) {
      return unavailableRateLimitCheck({
        identity,
        maxAttempts: params.maxAttempts,
        windowSeconds: params.windowSeconds,
      });
    }

    return {
      allowed: true,
      auditAvailable: false,
      identity,
      retryAfterSeconds: null,
      attemptsInWindow: 0,
      maxAttempts: params.maxAttempts,
      windowSeconds: params.windowSeconds,
      reason: null,
    };
  }

  const rows = (data ?? []) as RateLimitEventRow[];
  const blocked = rows.length >= params.maxAttempts;
  const retryAfterSeconds = blocked
    ? secondsUntilWindowClears(rows, params.windowSeconds)
    : null;

  const auditAvailable = await recordRateLimitEvent({
    supabase,
    storeId,
    endpointKey,
    subjectKey,
    identity,
    blocked,
    blockReason: blocked ? "too_many_attempts" : null,
    windowSeconds: params.windowSeconds,
    maxAttempts: params.maxAttempts,
  });

  if (!blocked && !auditAvailable && failClosed) {
    return unavailableRateLimitCheck({
      identity,
      maxAttempts: params.maxAttempts,
      windowSeconds: params.windowSeconds,
    });
  }

  return {
    allowed: !blocked,
    auditAvailable,
    identity,
    retryAfterSeconds,
    attemptsInWindow: rows.length,
    maxAttempts: params.maxAttempts,
    windowSeconds: params.windowSeconds,
    reason: blocked ? "too_many_attempts" : null,
  };
}

export function publicEndpointRateLimitResponse(check: PublicEndpointRateLimitCheck) {
  if (check.reason === "rate_limit_unavailable") {
    return {
      status: 503,
      body: {
        error:
          "Security checks are temporarily unavailable. Please try again shortly.",
        reason: check.reason,
      },
    };
  }

  if (check.reason === "too_many_attempts") {
    const minutes = Math.max(1, Math.ceil((check.retryAfterSeconds || 60) / 60));

    return {
      status: 429,
      body: {
        error: `Too many attempts. Try again in ${minutes} minute${
          minutes === 1 ? "" : "s"
        }.`,
      },
    };
  }

  return {
    status: 403,
    body: {
      error: "Sorry, you must turn off your proxy or VPN to use this website.",
      reason: check.reason,
    },
  };
}

export const publicEndpointRateLimitPolicies = {
  checkout: {
    endpointKey: "checkout",
    maxAttempts: 12,
    windowSeconds: 10 * 60,
  },
  publicOfferCreate: {
    endpointKey: "public_offer_create",
    maxAttempts: 8,
    windowSeconds: 15 * 60,
  },
  bindingOffer: {
    endpointKey: "binding_offer_setup",
    maxAttempts: 6,
    windowSeconds: 60 * 60,
  },
  sellerPayoutOnboarding: {
    endpointKey: "seller_payout_onboarding",
    maxAttempts: 5,
    windowSeconds: 60 * 60,
  },
};
