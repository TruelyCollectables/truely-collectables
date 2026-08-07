import { lookup } from "node:dns/promises";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEALTH_TIMEOUT_MS = 20_000;
const DNS_TIMEOUT_MS = 5_000;

function configuredLocalUrl() {
  const value = String(process.env.INSTACOMP_AI_LOCAL_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(value)) return null;
  if (
    process.env.NODE_ENV === "production" &&
    /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/i.test(value)
  ) {
    return null;
  }
  return value;
}

function readinessResponse(
  payload: Record<string, unknown>,
  status = 200,
) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function normalizedErrorCode(value: unknown) {
  const code = String(value || "")
    .trim()
    .toUpperCase();
  const allowed = new Set([
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "CERT_HAS_EXPIRED",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
  ]);
  return allowed.has(code) ? code.toLowerCase() : null;
}

function safeNetworkFailure(error: unknown) {
  const record =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : null;
  const cause =
    record?.cause && typeof record.cause === "object"
      ? (record.cause as Record<string, unknown>)
      : null;
  const name = String(record?.name || "").trim();
  const message = String(record?.message || "").toLowerCase();
  const timedOut =
    name === "TimeoutError" ||
    name === "AbortError" ||
    /timeout|timed out/.test(message);
  const code =
    normalizedErrorCode(cause?.code) || normalizedErrorCode(record?.code);

  return {
    reason: timedOut
      ? "internal_engine_health_timeout"
      : code
        ? `internal_engine_network_${code}`
        : "internal_engine_health_unreachable",
    networkErrorCode: code,
    networkErrorName:
      name === "TypeError" || name === "TimeoutError" || name === "AbortError"
        ? name
        : null,
  };
}

async function resolveConfiguredHostname(baseUrl: string) {
  const hostname = new URL(baseUrl).hostname;
  try {
    const records = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("dns_timeout")), DNS_TIMEOUT_MS);
      }),
    ]);
    return {
      dnsResolved: records.length > 0,
      dnsRecordCount: records.length,
      dnsFamilies: Array.from(
        new Set(records.map((record) => record.family)),
      ).sort(),
      dnsErrorCode: null,
    };
  } catch (error) {
    const record =
      error && typeof error === "object"
        ? (error as Record<string, unknown>)
        : null;
    const code = normalizedErrorCode(record?.code);
    return {
      dnsResolved: false,
      dnsRecordCount: 0,
      dnsFamilies: [] as number[],
      dnsErrorCode: code || "dns_lookup_failed",
    };
  }
}

async function fetchRuntimeIdentity(baseUrl: string, headers: Headers) {
  try {
    const response = await fetch(`${baseUrl}/v1/runtime-identity`, {
      headers,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    const payload = (await response.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!response.ok || !payload) return null;
    const fingerprint = String(payload.runtime_source_fingerprint || "").trim();
    return fingerprint || null;
  } catch {
    return null;
  }
}

export async function GET() {
  const baseUrl = configuredLocalUrl();
  if (!baseUrl) {
    return readinessResponse(
      {
        ok: false,
        configured: false,
        reachable: false,
        dnsResolved: false,
        internalMemoryReady: false,
        checklistReady: false,
        localModelReady: false,
        runtimeSourceFingerprint: null,
        architecture: ["instacomp_ai"],
        reason: "internal_engine_url_not_configured",
      },
      503,
    );
  }

  const dns = await resolveConfiguredHostname(baseUrl);

  try {
    const headers = new Headers();
    const key = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
    if (key) headers.set("X-InstaComp-AI-Key", key);
    const response = await fetch(`${baseUrl}/health`, {
      headers,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    const health = (await response.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!response.ok || !health) {
      return readinessResponse(
        {
          ok: false,
          configured: true,
          reachable: true,
          ...dns,
          internalMemoryReady: false,
          checklistReady: false,
          localModelReady: false,
          runtimeSourceFingerprint: null,
          architecture: ["instacomp_ai"],
          reason: `internal_health_http_${response.status}`,
        },
        503,
      );
    }

    const runtimeSourceFingerprint = await fetchRuntimeIdentity(baseUrl, headers);
    const internalMemoryReady = health.database === "ready";
    const checklistReady = health.checklist === "ready";
    // InstaComp identity scans are checklist-only. Ollama is not part of readiness.
    const localModelReady = internalMemoryReady && checklistReady;
    const ok = localModelReady;
    return readinessResponse(
      {
        ok,
        configured: true,
        reachable: true,
        ...dns,
        internalMemoryReady,
        checklistReady,
        localModelReady,
        app: typeof health.app === "string" ? health.app : "InstaComp AI",
        version: typeof health.version === "string" ? health.version : null,
        runtimeSourceFingerprint,
        architecture: ["instacomp_ai"],
        reason: ok ? null : "internal_engine_not_fully_ready",
      },
      ok ? 200 : 503,
    );
  } catch (error) {
    const failure = safeNetworkFailure(error);
    return readinessResponse(
      {
        ok: false,
        configured: true,
        reachable: false,
        ...dns,
        internalMemoryReady: false,
        checklistReady: false,
        localModelReady: false,
        runtimeSourceFingerprint: null,
        architecture: ["instacomp_ai"],
        ...failure,
      },
      503,
    );
  }
}
