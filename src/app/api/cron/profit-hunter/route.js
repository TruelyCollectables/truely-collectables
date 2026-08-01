import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isAuthorizedMarketIntelIngest } from "../../../../lib/market-intel-ingestion";
import { sendRankedProfitHunterEmail } from "../../../../lib/profit-hunter-ranked-email.js";
import {
  getProfitHunterScheduleState,
  PROFIT_HUNTER_SERVER_CONTRACT,
  runProfitHunterServerCycle,
} from "../../../../lib/profit-hunter-server-run.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

function deploymentInfo() {
  return {
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || null,
    commitSha:
      String(process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 12) || null,
    branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    region: process.env.VERCEL_REGION || null,
  };
}

function json(payload, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorizedProfitHunterCron(request) {
  if (isAuthorizedMarketIntelIngest(request)) return true;

  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const supplied = (
    request.headers.get("x-market-intel-key") || bearer
  ).trim();
  if (!supplied) return false;

  const configuredSecrets = Array.from(
    new Set(
      [
        process.env.PROFIT_HUNTER_RUN_SECRET,
        process.env.MARKET_INTEL_INGEST_SECRET,
        process.env.CRON_SECRET,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );

  return configuredSecrets.some((secret) => secureEqual(secret, supplied));
}

function restoreEnvironment(name, previousValue) {
  if (previousValue === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = previousValue;
}

async function runCycleWithoutLegacyEmail(perQuery) {
  const previousEmailEnabled = process.env.MARKET_INTEL_EMAIL_ENABLED;
  process.env.MARKET_INTEL_EMAIL_ENABLED = "false";
  try {
    return await runProfitHunterServerCycle({ perQuery });
  } finally {
    restoreEnvironment("MARKET_INTEL_EMAIL_ENABLED", previousEmailEnabled);
  }
}

async function run(request) {
  const schedule = getProfitHunterScheduleState();
  const statusOnly = request.nextUrl.searchParams.get("statusOnly") === "1";
  if (statusOnly) {
    return json({
      ok: true,
      code: "PROFIT_HUNTER_SERVER_CRON_READY",
      deployment: deploymentInfo(),
      schedule,
      contract: PROFIT_HUNTER_SERVER_CONTRACT,
      executionPath: "vercel_server_cron",
      rankedEmail: {
        enabled: true,
        format: "ranked_clickable_shark_list_v1",
        legacyPlainReportEmailSuppressed: true,
      },
    });
  }

  if (!isAuthorizedProfitHunterCron(request)) {
    return json(
      {
        ok: false,
        code: "PROFIT_HUNTER_CRON_UNAUTHORIZED",
        error: "A valid Profit Hunter, Vercel cron, or Market Intel server secret is required.",
        deployment: deploymentInfo(),
      },
      401,
    );
  }

  const force = request.nextUrl.searchParams.get("force") === "1";
  if (!force && !schedule.allowed) {
    return json({
      ok: true,
      skipped: true,
      code: "OUTSIDE_PROFIT_HUNTER_MOUNTAIN_SCHEDULE",
      deployment: deploymentInfo(),
      schedule,
    });
  }

  try {
    const result = await runCycleWithoutLegacyEmail(
      Number(request.nextUrl.searchParams.get("perQuery") || 20),
    );
    const allowForcedEmail =
      request.nextUrl.searchParams.get("sendEmail") === "1";
    let rankedEmail;
    if (force && !allowForcedEmail) {
      rankedEmail = {
        attempted: false,
        delivered: false,
        skipped: true,
        reason:
          "Forced verification run completed without email. Add sendEmail=1 to deliberately deliver it.",
      };
    } else {
      try {
        rankedEmail = await sendRankedProfitHunterEmail({
          reportId: result.reportId,
        });
      } catch (error) {
        rankedEmail = {
          attempted: true,
          delivered: false,
          skipped: false,
          reason:
            error instanceof Error
              ? error.message
              : "Unable to send the ranked Shark List email.",
        };
      }
    }

    const emailFailed =
      rankedEmail.attempted === true &&
      rankedEmail.delivered !== true &&
      rankedEmail.skipped !== true;
    const ok = result.ok && !emailFailed;

    return json(
      {
        ...result,
        ok,
        rankedEmail,
        deployment: deploymentInfo(),
        forced: force,
      },
      ok ? 200 : 500,
    );
  } catch (error) {
    return json(
      {
        ok: false,
        code: "PROFIT_HUNTER_SERVER_RUN_FAILED",
        error:
          error instanceof Error
            ? error.message
            : "Unable to run Profit Hunter inside Vercel.",
        deployment: deploymentInfo(),
        schedule,
        forced: force,
      },
      500,
    );
  }
}

export const GET = run;
export const POST = run;
