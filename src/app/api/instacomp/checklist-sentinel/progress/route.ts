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

    const macResponse = await fetch(`${baseUrl}/v1/checklist-sentinel/status`, {
      headers: {
        "X-InstaComp-AI-Key": key,
        Accept: "application/json",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(45_000),
    });
    const status = await macResponse.json().catch(() => null);
    if (!macResponse.ok || !status || typeof status !== "object") {
      return response(
        {
          ok: false,
          code: "SENTINEL_PROGRESS_UNAVAILABLE",
          error: "Sentinel progress is temporarily unavailable.",
        },
        503,
      );
    }

    const latestJob =
      status.latest_job && typeof status.latest_job === "object"
        ? status.latest_job
        : {};
    const targets =
      status.targets && typeof status.targets === "object" ? status.targets : {};
    const freezeProtection =
      status.freeze_protection && typeof status.freeze_protection === "object"
        ? status.freeze_protection
        : {};

    const batchProcessed = finiteNumber(latestJob.processed_targets);
    const batchTotal = finiteNumber(latestJob.total_targets);

    return response({
      ok: true,
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
      targets: {
        total: finiteNumber(targets.total),
        pending: finiteNumber(targets.pending),
        recovered: finiteNumber(targets.recovered),
        noResult: finiteNumber(targets.no_result),
        leadOnly: finiteNumber(targets.lead_only),
        failed: finiteNumber(targets.failed),
      },
      freezeStale: Boolean(freezeProtection.stale),
    });
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
