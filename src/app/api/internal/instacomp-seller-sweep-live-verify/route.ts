import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE_NAME,
  createAdminSessionValue,
} from "../../../../lib/admin-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const SELLER_URL = "https://www.ebay.com/str/missmelscards";
const QUERY_LADDER = ["WNBA lot", "sports card", "trading card"] as const;
const LIVE_LISTING_LIMIT = 1;
const VERIFY_HEADER = "x-instacomp-seller-sweep-live-verify";

type VerificationAction =
  | "workbench"
  | "collect"
  | "process"
  | "rank"
  | "status";

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function activeConfiguredSecret(value: string) {
  const separator = value.indexOf(".");
  if (separator < 1) return false;

  const expiresAtSeconds = Number(value.slice(0, separator));
  return (
    Number.isSafeInteger(expiresAtSeconds) &&
    expiresAtSeconds > Math.floor(Date.now() / 1000)
  );
}

function diagnosticMessage(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function validSweepId(value: unknown) {
  const sweepId = String(value || "").trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      sweepId,
    )
  ) {
    throw new Error("A valid Seller Sweep identifier is required.");
  }
  return sweepId;
}

async function protectedFetch(
  origin: string,
  sessionValue: string,
  path: string,
  init: RequestInit = {},
) {
  const method = String(init.method || "GET").toUpperCase();
  const mutationHeaders = ["GET", "HEAD", "OPTIONS"].includes(method)
    ? {}
    : { Origin: origin };

  return fetch(`${origin}${path}`, {
    cache: "no-store",
    redirect: "manual",
    ...init,
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent": "TCOSSellerSweepRuntimeVerifier/1.0",
      Cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionValue}`,
      ...mutationHeaders,
      ...(init.headers || {}),
    },
  });
}

async function protectedJson(
  origin: string,
  sessionValue: string,
  path: string,
  init: RequestInit,
) {
  const response = await protectedFetch(origin, sessionValue, path, init);
  const text = await response.text();
  let result: unknown = {};

  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Protected ${path} returned non-JSON HTTP ${response.status}.`);
  }

  if (!response.ok) {
    const upstreamError =
      typeof result === "object" && result && "error" in result
        ? (result as { error?: unknown }).error
        : "";
    throw new Error(
      `Protected ${path} failed with HTTP ${response.status}: ${diagnosticMessage(upstreamError)}`,
    );
  }

  return result;
}

async function runAction(
  origin: string,
  sessionValue: string,
  action: VerificationAction,
  body: Record<string, unknown>,
) {
  if (action === "workbench") {
    const response = await protectedFetch(
      origin,
      sessionValue,
      `/admin/instacomp/seller-sweep?live_verify=${Date.now()}`,
    );
    const html = await response.text();
    if (!response.ok || !html.includes("Seller Sweep")) {
      throw new Error(
        `Seller Sweep workbench was unavailable (HTTP ${response.status}).`,
      );
    }
    return { available: true };
  }

  if (action === "collect") {
    const queryIndex = Number(body.queryIndex);
    if (!Number.isInteger(queryIndex) || !QUERY_LADDER[queryIndex]) {
      throw new Error("Seller Sweep query index is outside the bounded ladder.");
    }
    return protectedJson(
      origin,
      sessionValue,
      "/api/admin/instacomp/seller-sweep",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sellerUrl: SELLER_URL,
          query: QUERY_LADDER[queryIndex],
          limit: LIVE_LISTING_LIMIT,
        }),
      },
    );
  }

  const sweepId = validSweepId(body.sweepId);
  if (action === "status") {
    return protectedJson(
      origin,
      sessionValue,
      `/api/admin/instacomp/seller-sweep/status?sweepId=${encodeURIComponent(sweepId)}`,
      { method: "GET" },
    );
  }

  return protectedJson(
    origin,
    sessionValue,
    `/api/admin/instacomp/seller-sweep/${action}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sweepId, batchSize: 1 }),
    },
  );
}

export async function POST(request: Request) {
  const configuredSecret = String(
    process.env.INSTACOMP_SELLER_SWEEP_LIVE_VERIFY_SECRET || "",
  ).trim();
  const providedSecret = String(request.headers.get(VERIFY_HEADER) || "").trim();

  if (
    !configuredSecret ||
    !activeConfiguredSecret(configuredSecret) ||
    !providedSecret ||
    !safeEqual(configuredSecret, providedSecret)
  ) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized Seller Sweep verification request." },
      { status: 401 },
    );
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || "") as VerificationAction;
    if (!["workbench", "collect", "process", "rank", "status"].includes(action)) {
      throw new Error("Unsupported Seller Sweep verification action.");
    }

    const origin = new URL(request.url).origin;
    const sessionValue = await createAdminSessionValue();
    const result = await runAction(origin, sessionValue, action, body);

    return NextResponse.json(
      { ok: true, action, result },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Unknown verification error.",
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store, max-age=0" },
      },
    );
  }
}
