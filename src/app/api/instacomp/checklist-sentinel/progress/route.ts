import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function response(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "public, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function configuredMacUrl() {
  const value = String(process.env.INSTACOMP_AI_LOCAL_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (!/^https:\/\//i.test(value)) return null;
  if (/^https:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/i.test(value)) return null;
  return value;
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function roundedPercent(processed: number, total: number) {
  if (!total) return 0;
  return Math.round((processed * 1000) / total) / 10;
}

function sanitizedTargets(raw: unknown) {
  const targets = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    total: finiteNumber(targets.total),
    pending: finiteNumber(targets.pending),
    recovered: finiteNumber(targets.recovered),
    noResult: finiteNumber(targets.no_result),
    leadOnly: finiteNumber(targets.lead_only),
    failed: finiteNumber(targets.failed),
  };
}

async function fetchMacJson(
  baseUrl: string,
  key: string,
  path: string,
): Promise<{ response: Response; payload: Record<string, unknown> | null }> {
  const macResponse = await fetch(`${baseUrl}${path}`, {
    headers: {
      "X-InstaComp-AI-Key": key,
      Accept: "application/json",
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await macResponse.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  return { response: macResponse, payload };
}

export async function GET() {
  try {
    const baseUrl = configuredMacUrl();
    const key = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
    if (!baseUrl || !key) {
      return response(
        {
          ok: false,
          code: "SENTINEL_PROGRESS_NOT_CONFIGURED",
          error: "Sentinel progress is not configured.",
        },
        503,
      );
    }

    const statusRead = await fetchMacJson(
      baseUrl,
      key,
      "/v1/checklist-sentinel/status",
    );

    if (statusRead.response.ok && statusRead.payload) {
      const status = statusRead.payload;
      const latestJob =
        status.latest_job && typeof status.latest_job === "object"
          ? status.latest_job as Record<string, unknown>
          : {};
      const freezeProtection =
        status.freeze_protection && typeof status.freeze_protection === "object"
          ? status.freeze_protection as Record<string, unknown>
          : {};
      const batchProcessed = finiteNumber(latestJob.processed_targets);
      const batchTotal = finiteNumber(latestJob.total_targets);

      return response({
        ok: true,
        degraded: false,
        source: "status",
        checkedAt: new Date().toISOString(),
        job: {
          status: String(latestJob.status || "unknown"),
          trigger: String(latestJob.trigger || "unknown"),
          currentTarget: latestJob.current_target_key
            ? String(latestJob.current_target_key)
            : null,
          processed: batchProcessed,
          total: batchTotal,
          percent: roundedPercent(batchProcessed, batchTotal),
          found: finiteNumber(latestJob.found_count),
          downloaded: finiteNumber(latestJob.downloaded_count),
          imported: finiteNumber(latestJob.imported_count),
          failed: finiteNumber(latestJob.failed_count),
          heartbeatAt: latestJob.heartbeat_at ? String(latestJob.heartbeat_at) : null,
        },
        targets: sanitizedTargets(status.targets),
        freezeStale: Boolean(freezeProtection.stale),
      });
    }

    // Keep progress observable even if the richer status view is unhealthy.
    // The targets endpoint is independent of latest-job/checkpoint decoding and
    // still provides the authoritative live queue counts needed for the sprint bar.
    const targetsRead = await fetchMacJson(
      baseUrl,
      key,
      "/v1/checklist-sentinel/targets?limit=1",
    );
    if (targetsRead.response.ok && targetsRead.payload) {
      return response({
        ok: true,
        degraded: true,
        source: "targets_fallback",
        checkedAt: new Date().toISOString(),
        upstreamStatus: statusRead.response.status,
        job: {
          status: "unknown",
          trigger: "unknown",
          currentTarget: null,
          processed: 0,
          total: 0,
          percent: 0,
          found: 0,
          downloaded: 0,
          imported: 0,
          failed: 0,
          heartbeatAt: null,
        },
        targets: sanitizedTargets(targetsRead.payload.counts),
        freezeStale: null,
      });
    }

    return response(
      {
        ok: false,
        code: "SENTINEL_PROGRESS_UNAVAILABLE",
        error: "Sentinel progress is temporarily unavailable.",
        upstreamStatus: statusRead.response.status,
        fallbackStatus: targetsRead.response.status,
      },
      503,
    );
  } catch (error) {
    const name = error instanceof Error ? error.name : "UnknownError";
    const timeout = name === "TimeoutError" || name === "AbortError";
    return response(
      {
        ok: false,
        code: timeout ? "SENTINEL_PROGRESS_TIMEOUT" : "SENTINEL_PROGRESS_FAILED",
        error: timeout
          ? "Sentinel progress timed out."
          : "Sentinel progress could not be read.",
      },
      503,
    );
  }
}
