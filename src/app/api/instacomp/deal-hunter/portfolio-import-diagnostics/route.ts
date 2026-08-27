import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function matchesSecret(provided: string, expected: string) {
  return Boolean(expected && provided && expected.length === provided.length && expected === provided);
}

function authorize(request: Request) {
  const instaCompExpected = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
  const instaCompProvided = String(request.headers.get("x-instacomp-ai-key") || "").trim();
  if (matchesSecret(instaCompProvided, instaCompExpected)) return true;

  const cronExpected = String(process.env.TCOS_CRON_SECRET || "").trim();
  const cronProvided = String(request.headers.get("x-tcos-cron-secret") || "").trim();
  return matchesSecret(cronProvided, cronExpected);
}

async function run(label: string, loader: () => Promise<unknown>) {
  try {
    await loader();
    return { label, ok: true, error: null as string | null };
  } catch (error) {
    return {
      label,
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return json({ ok: false, error: "Invalid trusted diagnostic credential." }, 401);
  }

  const checks: Array<[string, () => Promise<unknown>]> = [
    ["lib/supabase-server", () => import("../../../../../lib/supabase-server")],
    ["lib/tcos-profit-hunter-secrets", () => import("../../../../../lib/tcos-profit-hunter-secrets")],
    ["lib/instacomp-market-history", () => import("../../../../../lib/instacomp-market-history")],
    ["lib/instacomp", () => import("../../../../../lib/instacomp")],
    ["lib/instacomp-serial", () => import("../../../../../lib/instacomp-serial")],
    ["lib/instacomp-scan-review", () => import("../../../../../lib/instacomp-scan-review")],
    ["lib/instacomp-market-evidence", () => import("../../../../../lib/instacomp-market-evidence")],
    ["lib/instacomp-consensus", () => import("../../../../../lib/instacomp-consensus")],
    ["lib/instacomp-job-server", () => import("../../../../../lib/instacomp-job-server")],
    ["lib/instacomp-mutation-security", () => import("../../../../../lib/instacomp-mutation-security")],
    ["lib/instacomp-identity-guard", () => import("../../../../../lib/instacomp-identity-guard")],
    ["lib/instacomp-curated-checklist", () => import("../../../../../lib/instacomp-curated-checklist")],
    ["lib/grading-cert", () => import("../../../../../lib/grading-cert")],
    ["lib/instacomp-image-orientation", () => import("../../../../../lib/instacomp-image-orientation")],
    ["lib/instacomp-listing-identity-hint", () => import("../../../../../lib/instacomp-listing-identity-hint")],
    ["lib/instacomp-image-safety", () => import("../../../../../lib/instacomp-image-safety")],
    ["lib/instacomp-ai-council-security", () => import("../../../../../lib/instacomp-ai-council-security")],
    ["lib/instacomp-ai-provider-failover", () => import("../../../../../lib/instacomp-ai-provider-failover")],
    ["lib/instacomp-ai-council-runtime", () => import("../../../../../lib/instacomp-ai-council-runtime")],
    ["lib/instacomp-learning-server", () => import("../../../../../lib/instacomp-learning-server")],
    ["lib/instacomp-ai-local", () => import("../../../../../lib/instacomp-ai-local")],
    ["api/instacomp/scan/route", () => import("../../scan/route")],
    ["lib/instacomp-exact-market-provider", () => import("../../../../../lib/instacomp-exact-market-provider")],
    ["lib/instacomp-openai-web-market-provider", () => import("../../../../../lib/instacomp-openai-web-market-provider")],
    ["lib/instacomp-teacher-market-provider", () => import("../../../../../lib/instacomp-teacher-market-provider")],
    ["lib/instacomp-teacher-learning-bridge", () => import("../../../../../lib/instacomp-teacher-learning-bridge")],
    ["lib/instacomp-comp-visual-verification", () => import("../../../../../lib/instacomp-comp-visual-verification")],
    ["lib/instacomp-provider-safety", () => import("../../../../../lib/instacomp-provider-safety")],
    ["lib/instacomp-live-pipeline", () => import("../../../../../lib/instacomp-live-pipeline")],
    ["lib/public-endpoint-rate-limit", () => import("../../../../../lib/public-endpoint-rate-limit")],
    ["api/instacomp/live-scan/route", () => import("../../live-scan/route")],
    ["lib/deal-hunter-trusted-sold-history", () => import("../../../../../lib/deal-hunter-trusted-sold-history")],
    ["api/instacomp/deal-hunter/evaluate/core", () => import("../evaluate/core")],
  ];

  const results = [];
  for (const [label, loader] of checks) {
    const result = await run(label, loader);
    results.push(result);
    if (!result.ok) {
      return json({
        ok: false,
        schema: "tcos.instacomp.import-diagnostics.v1",
        firstFailure: result,
        passedBeforeFailure: results.filter((entry) => entry.ok).map((entry) => entry.label),
      }, 500);
    }
  }

  return json({
    ok: true,
    schema: "tcos.instacomp.import-diagnostics.v1",
    firstFailure: null,
    passed: results.map((entry) => entry.label),
  });
}
