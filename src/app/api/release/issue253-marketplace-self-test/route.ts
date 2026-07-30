import { GET as runEbayOrderSaleSync } from "../../cron/ebay-order-sale-sync/route";
import { GET as runEbayStoreFixedPriceSync } from "../../cron/ebay-store-fixed-price-sync/route";
import { GET as runSellerEbayReconciliation } from "../../cron/seller-ebay-reconciliation/route";
import { GET as runSoldCollectibleArchive } from "../../cron/sold-collectible-archive/route";
import { releaseRuntimeTeamIsAllowed } from "../../../../lib/vercel-release-runtime-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RuntimeStep =
  | "ebay-order-sales"
  | "ebay-full-sync"
  | "seller-reconciliation"
  | "sold-archive";

type CronHandler = (request: Request) => Promise<Response>;

const STEP_HANDLERS: Record<
  RuntimeStep,
  { path: string; handler: CronHandler }
> = {
  "ebay-order-sales": {
    path: "/api/cron/ebay-order-sale-sync?lookbackDays=90",
    handler: runEbayOrderSaleSync,
  },
  "ebay-full-sync": {
    path: "/api/cron/ebay-store-fixed-price-sync",
    handler: runEbayStoreFixedPriceSync,
  },
  "seller-reconciliation": {
    path: "/api/cron/seller-ebay-reconciliation",
    handler: runSellerEbayReconciliation,
  },
  "sold-archive": {
    path: "/api/cron/sold-collectible-archive",
    handler: runSoldCollectibleArchive,
  },
};

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
}

async function verifyVercelToken(request: Request) {
  const token = bearerToken(request);
  if (!token) return false;

  try {
    const response = await fetch("https://api.vercel.com/v2/teams?limit=100", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { teams?: unknown };
    return releaseRuntimeTeamIsAllowed(payload.teams);
  } catch {
    return false;
  }
}

function sanitized(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value
      .replace(/sk_(?:live|test)_[A-Za-z0-9_-]+/g, "[REDACTED_STRIPE_KEY]")
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
      .slice(0, 2_000);
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitized(item, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/token|secret|password|authorization|credential/i.test(key)) {
      output[key] = "[REDACTED]";
      continue;
    }
    output[key] = sanitized(child, depth + 1);
  }
  return output;
}

function runtimeRequest(request: Request, path: string, cronSecret: string) {
  const origin = new URL(request.url).origin;
  return new Request(new URL(path, origin), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${cronSecret}`,
      "User-Agent": "TruelyCollectables-Launch2-Issue253-Runtime-Self-Test",
    },
    cache: "no-store",
  });
}

export async function POST(request: Request) {
  if (!(await verifyVercelToken(request))) {
    return Response.json(
      { success: false, error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const step = new URL(request.url).searchParams.get("step") as RuntimeStep | null;
  if (!step || !Object.hasOwn(STEP_HANDLERS, step)) {
    return Response.json(
      {
        success: false,
        error: "Unknown runtime step.",
        allowedSteps: Object.keys(STEP_HANDLERS),
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  if (cronSecret.length < 16) {
    return Response.json(
      { success: false, error: "Production cron authorization is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const selected = STEP_HANDLERS[step];
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  try {
    const response = await selected.handler(
      runtimeRequest(request, selected.path, cronSecret),
    );
    const text = await response.text();
    let payload: unknown = text;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text.slice(0, 2_000);
    }

    const payloadSuccess =
      typeof payload !== "object" || payload === null
        ? response.status === 200
        : (payload as { success?: unknown }).success !== false;
    const passed = response.status === 200 && payloadSuccess;

    return Response.json(
      {
        success: passed,
        schema: "truelycollectables.issue253MarketplaceRuntimeSelfTest.v1",
        step,
        sourcePath: selected.path,
        cronSecretConfigured: true,
        upstreamStatus: response.status,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedMs,
        result: sanitized(payload),
      },
      {
        status: passed ? 200 : 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        schema: "truelycollectables.issue253MarketplaceRuntimeSelfTest.v1",
        step,
        sourcePath: selected.path,
        cronSecretConfigured: true,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedMs,
        error: sanitized(error instanceof Error ? error.message : String(error)),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
