import type { SupabaseClient } from "@supabase/supabase-js";
import { getClientIdentity, type ClientIdentity } from "./client-identity";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

type RateLimitEventRow = {
  id: string;
  created_at: string;
};

type AtomicRateLimitReceipt = {
  allowed?: boolean;
  reason?: string | null;
  retryAfterSeconds?: number | null;
  attemptsInWindow?: number;
  maxAttempts?: number;
  windowSeconds?: number;
  burstAttempts?: number | null;
  burstMaxAttempts?: number | null;
  burstWindowSeconds?: number | null;
};

type EffectiveRateLimitPolicy = {
  maxAttempts: number;
  windowSeconds: number;
  burstMaxAttempts: number | null;
  burstWindowSeconds: number | null;
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

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isInteger(parsed)
    ? Math.max(minimum, Math.min(maximum, parsed))
    : fallback;
}

function effectiveRateLimitPolicy(params: {
  endpointKey: string;
  maxAttempts: number;
  windowSeconds: number;
}): EffectiveRateLimitPolicy {
  const maxAttempts = boundedInteger(params.maxAttempts, 1, 1, 100_000);
  const windowSeconds = boundedInteger(
    params.windowSeconds,
    60,
    1,
    30 * 24 * 60 * 60,
  );

  if (params.endpointKey === "instacomp_scan") {
    const dailyLimit = boundedInteger(
      process.env.INSTACOMP_SCAN_DAILY_LIMIT,
      250,
      25,
      2_000,
    );
    const burstLimit = boundedInteger(
      process.env.INSTACOMP_SCAN_BURST_LIMIT,
      12,
      2,
      60,
    );
    const burstWindow = boundedInteger(
      process.env.INSTACOMP_SCAN_BURST_WINDOW_SECONDS,
      60,
      15,
      15 * 60,
    );

    return {
      maxAttempts: Math.min(maxAttempts, dailyLimit),
      windowSeconds,
      burstMaxAttempts: Math.min(burstLimit, Math.min(maxAttempts, dailyLimit)),
      burstWindowSeconds: Math.min(burstWindow, windowSeconds),
    };
  }

  return {
    maxAttempts,
    windowSeconds,
    burstMaxAttempts: null,
    burstWindowSeconds: null,
  };
}

function isMissingRateLimitCapability(error: {
  code?: string;
  message?: string;
  details?: string;
}) {
  const message = [error.message, error.details]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "42883" ||
    error.code === "PGRST202" ||
    error.code === "PGRST205" ||
    message.includes("public_endpoint_rate_limit_events") ||
    message.includes("tcos_take_public_endpoint_rate_limit")
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

async function takeAtomicRateLimit(params: {
  supabase: SupabaseClient;
  storeId: string;
  endpointKey: string;
  subjectKey: string | null;
  identity: ClientIdentity;
  policy: EffectiveRateLimitPolicy;
}) {
  const { data, error } = await params.supabase.rpc(
    "tcos_take_public_endpoint_rate_limit",
    {
      p_store_id: params.storeId,
      p_endpoint_key: params.endpointKey,
      p_subject_key: params.subjectKey,
      p_ip_address: params.identity.ipAddress || "unknown",
      p_user_agent: params.identity.userAgent || null,
      p_identity_risk: params.identity.risk || null,
      p_identity_evidence: params.identity.evidence || {},
      p_window_seconds: params.policy.windowSeconds,
      p_max_attempts: params.policy.maxAttempts,
      p_burst_window_seconds: params.policy.burstWindowSeconds,
      p_burst_max_attempts: params.policy.burstMaxAttempts,
    },
  );

  if (error) {
    return {
      receipt: null,
      missing: isMissingRateLimitCapability(error),
      error,
    };
  }

  const receipt = (Array.isArray(data) ? data[0] : data) as
    | AtomicRateLimitReceipt
    | null;
  if (!receipt || typeof receipt.allowed !== "boolean") {
    return {
      receipt: null,
      missing: false,
      error: { message: "Atomic rate-limit RPC returned an invalid receipt." },
    };
  }

  return { receipt, missing: false, error: null };
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
  const policy = effectiveRateLimitPolicy({
    endpointKey,
    maxAttempts: params.maxAttempts,
    windowSeconds: params.windowSeconds,
  });

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
          windowSeconds: policy.windowSeconds,
          maxAttempts: policy.maxAttempts,
        })
      : false;

    return {
      allowed: false,
      auditAvailable,
      identity,
      retryAfterSeconds: null,
      attemptsInWindow: policy.maxAttempts,
      maxAttempts: policy.maxAttempts,
      windowSeconds: policy.windowSeconds,
      reason: identity.blockReason || "blocked_identity",
    };
  }

  if (!supabase) {
    return failClosed
      ? unavailableRateLimitCheck({
          identity,
          maxAttempts: policy.maxAttempts,
          windowSeconds: policy.windowSeconds,
        })
      : {
          allowed: true,
          auditAvailable: false,
          identity,
          retryAfterSeconds: null,
          attemptsInWindow: 0,
          maxAttempts: policy.maxAttempts,
          windowSeconds: policy.windowSeconds,
          reason: null,
        };
  }

  const atomic = await takeAtomicRateLimit({
    supabase,
    storeId,
    endpointKey,
    subjectKey,
    identity,
    policy,
  });

  if (atomic.receipt) {
    return {
      allowed: atomic.receipt.allowed === true,
      auditAvailable: true,
      identity,
      retryAfterSeconds:
        Number.isFinite(Number(atomic.receipt.retryAfterSeconds)) &&
        Number(atomic.receipt.retryAfterSeconds) > 0
          ? Number(atomic.receipt.retryAfterSeconds)
          : null,
      attemptsInWindow: Math.max(
        0,
        Number(atomic.receipt.attemptsInWindow || 0),
      ),
      maxAttempts: Math.max(
        1,
        Number(atomic.receipt.maxAttempts || policy.maxAttempts),
      ),
      windowSeconds: Math.max(
        1,
        Number(atomic.receipt.windowSeconds || policy.windowSeconds),
      ),
      reason: atomic.receipt.reason || null,
    };
  }

  if (!atomic.missing) {
    console.error(
      "Atomic public endpoint rate limit failed:",
      atomic.error?.message || "unknown error",
    );
    if (failClosed) {
      return unavailableRateLimitCheck({
        identity,
        maxAttempts: policy.maxAttempts,
        windowSeconds: policy.windowSeconds,
      });
    }
  }

  // Compatibility fallback while the atomic RPC migration reaches an
  // environment. This path remains fail-closed in Production if its audit
  // insert cannot be persisted.
  let query = supabase
    .from("public_endpoint_rate_limit_events")
    .select("id,created_at")
    .eq("store_id", storeId)
    .eq("endpoint_key", endpointKey)
    .gte("created_at", windowStart(policy.windowSeconds))
    .order("created_at", { ascending: false })
    .limit(policy.maxAttempts + 5);

  if (subjectKey) {
    query = query.or(
      `subject_key.eq.${subjectKey},ip_address.eq.${identity.ipAddress || "unknown"}`,
    );
  } else {
    query = query.eq("ip_address", identity.ipAddress || "unknown");
  }

  const { data, error } = await query;

  if (error) {
    if (!isMissingRateLimitCapability(error)) {
      console.error("Public endpoint rate-limit query failed:", error.message);
    }

    if (failClosed) {
      return unavailableRateLimitCheck({
        identity,
        maxAttempts: policy.maxAttempts,
        windowSeconds: policy.windowSeconds,
      });
    }

    return {
      allowed: true,
      auditAvailable: false,
      identity,
      retryAfterSeconds: null,
      attemptsInWindow: 0,
      maxAttempts: policy.maxAttempts,
      windowSeconds: policy.windowSeconds,
      reason: null,
    };
  }

  const rows = (data ?? []) as RateLimitEventRow[];
  const blocked = rows.length >= policy.maxAttempts;
  const retryAfterSeconds = blocked
    ? secondsUntilWindowClears(rows, policy.windowSeconds)
    : null;

  const auditAvailable = await recordRateLimitEvent({
    supabase,
    storeId,
    endpointKey,
    subjectKey,
    identity,
    blocked,
    blockReason: blocked ? "too_many_attempts" : null,
    windowSeconds: policy.windowSeconds,
    maxAttempts: policy.maxAttempts,
  });

  if (!blocked && !auditAvailable && failClosed) {
    return unavailableRateLimitCheck({
      identity,
      maxAttempts: policy.maxAttempts,
      windowSeconds: policy.windowSeconds,
    });
  }

  return {
    allowed: !blocked,
    auditAvailable,
    identity,
    retryAfterSeconds,
    attemptsInWindow: rows.length + 1,
    maxAttempts: policy.maxAttempts,
    windowSeconds: policy.windowSeconds,
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

  if (
    check.reason === "too_many_attempts" ||
    check.reason === "burst_limit"
  ) {
    const seconds = Math.max(1, check.retryAfterSeconds || 60);
    const wait =
      seconds < 120
        ? `${seconds} second${seconds === 1 ? "" : "s"}`
        : `${Math.ceil(seconds / 60)} minutes`;

    return {
      status: 429,
      body: {
        error: `Too many attempts. Try again in ${wait}.`,
        reason: check.reason,
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
