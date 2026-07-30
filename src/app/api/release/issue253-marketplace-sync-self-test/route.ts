import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const TEAM_SLUG = "truelycollectables-projects";
const PRODUCTION_ORIGIN = "https://truelycollectables.com";

const STAGE_PATHS = {
  order: "/api/cron/ebay-order-sale-sync?lookbackDays=90",
  full: "/api/cron/ebay-store-fixed-price-sync",
  reconciliation: "/api/cron/seller-ebay-reconciliation",
} as const;

type Stage = keyof typeof STAGE_PATHS;

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() || "";
}

async function hasAuthorizedVercelTeamToken(token: string) {
  if (!token || token.length < 20) return false;

  const response = await fetch("https://api.vercel.com/v2/teams?limit=100", {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "TCOS-Issue253-Marketplace-Sync-Self-Test/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) return false;

  const payload = await response.json().catch(() => null);
  const teams = Array.isArray(payload?.teams) ? payload.teams : [];
  return teams.some(
    (team: any) =>
      String(team?.slug || "") === TEAM_SLUG &&
      team?.membership?.confirmed !== false,
  );
}

function requestedStage(request: Request, body: unknown): Stage | null {
  const urlStage = new URL(request.url).searchParams.get("stage");
  const bodyStage =
    body && typeof body === "object" && !Array.isArray(body)
      ? String((body as Record<string, unknown>).stage || "")
      : "";
  const candidate = String(urlStage || bodyStage || "").trim();
  return candidate in STAGE_PATHS ? (candidate as Stage) : null;
}

function finiteCount(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizedSummary(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { responseObject: false };
  }

  const value = payload as Record<string, unknown>;
  return {
    responseObject: true,
    event: typeof value.event === "string" ? value.event.slice(0, 120) : null,
    success: typeof value.success === "boolean" ? value.success : null,
    ok: typeof value.ok === "boolean" ? value.ok : null,
    checked: finiteCount(value.checked),
    processed: finiteCount(value.processed),
    updated: finiteCount(value.updated),
    inserted: finiteCount(value.inserted),
    deactivated: finiteCount(value.deactivated),
    failed: finiteCount(value.failed),
    warningCount: Array.isArray(value.warnings) ? value.warnings.length : null,
    errorCount: Array.isArray(value.errors) ? value.errors.length : null,
  };
}

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!(await hasAuthorizedVercelTeamToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json(
      { error: "This self-test only runs in Vercel Production." },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => null);
  const stage = requestedStage(request, body);
  if (!stage) {
    return NextResponse.json(
      { error: "stage must be order, full, or reconciliation" },
      { status: 400 },
    );
  }

  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  if (cronSecret.length < 16) {
    return NextResponse.json(
      { error: "Production marketplace synchronization is not configured." },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(`${PRODUCTION_ORIGIN}${STAGE_PATHS[stage]}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "User-Agent": "TCOS-Issue253-Marketplace-Sync-Self-Test/1.0",
      },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    const summary = sanitizedSummary(payload);
    const upstreamRejected =
      !response.ok || summary.success === false || summary.ok === false;

    return NextResponse.json(
      {
        success: !upstreamRejected,
        stage,
        upstreamStatus: response.status,
        summary,
        secretReturned: false,
        verifiedAt: new Date().toISOString(),
      },
      {
        status: upstreamRejected ? 502 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        stage,
        error:
          error instanceof Error
            ? error.message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 300)
            : "Marketplace synchronization self-test failed.",
        secretReturned: false,
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
