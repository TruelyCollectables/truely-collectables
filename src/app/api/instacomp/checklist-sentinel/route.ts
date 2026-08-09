import { NextResponse } from "next/server";
import {
  InstaCompJobServerError,
  requireInstaCompJobActor,
  type InstaCompJobActor,
} from "../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../lib/instacomp-mutation-security";
import { isValidInstaCompSentinelArchiveRequest } from "../../../../lib/instacomp-sentinel-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GET_PATHS: Record<string, string> = {
  status: "/v1/checklist-sentinel/status",
  targets: "/v1/checklist-sentinel/targets?limit=500",
  findings: "/v1/checklist-sentinel/findings?limit=200",
  downloads: "/v1/checklist-sentinel/downloads?limit=200",
  sources: "/v1/checklist-sentinel/sources",
};

const GITHUB_RECOVERY_REPO = "TruelyCollectables/truely-collectables";
const GITHUB_RECOVERY_BRANCH = "ops/checklist-recovery-live-20260809";
const GITHUB_RECOVERY_WORKFLOW = "Checklist Recovery Live Requeue 20260809";
const GITHUB_RECOVERY_TARGET_PATH = "data/checklist-recovery-modern-gap-keys.txt";
const GITHUB_API_VERSION = "2022-11-28";

function response(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
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

async function requireAdmin(request: Request): Promise<InstaCompJobActor> {
  const actor = await requireInstaCompJobActor(request);
  if (actor.type !== "admin") {
    throw new InstaCompJobServerError(
      "TCOS administrator access is required.",
      403,
      "SENTINEL_ADMIN_REQUIRED",
    );
  }
  return actor;
}

async function callMac(path: string, init: RequestInit = {}) {
  const baseUrl = configuredMacUrl();
  const key = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
  if (!baseUrl || !key) {
    throw new InstaCompJobServerError(
      "The permanent InstaComp Mac connection is not configured in Production.",
      503,
      "SENTINEL_MAC_CONNECTION_NOT_CONFIGURED",
    );
  }
  const headers = new Headers(init.headers);
  headers.set("X-InstaComp-AI-Key", key);
  if (init.body) headers.set("content-type", "application/json");
  const macResponse = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await macResponse.json().catch(() => null);
  if (!macResponse.ok || !payload) {
    throw new InstaCompJobServerError(
      `InstaComp Mac returned HTTP ${macResponse.status}.`,
      502,
      "SENTINEL_MAC_REQUEST_FAILED",
    );
  }
  return payload;
}

function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": "Truely-Collectables-Checklist-Recovery",
  };
}

function recoveryTargetKeysFromText(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function exactStringArrayEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function requireTrustedGitHubRecoveryRun(
  request: Request,
  body: { githubRunId?: unknown; targetKeys?: unknown },
): Promise<string[]> {
  const token = String(request.headers.get("x-tcos-github-recovery-token") || "").trim();
  const runId = Number(body.githubRunId);
  const targetKeys = Array.isArray(body.targetKeys)
    ? body.targetKeys.map((value) => String(value || "").trim())
    : [];

  if (!token || !Number.isSafeInteger(runId) || runId <= 0) {
    throw new InstaCompJobServerError(
      "A valid GitHub recovery run is required.",
      403,
      "SENTINEL_GITHUB_RECOVERY_REQUIRED",
    );
  }
  if (targetKeys.length !== 375 || new Set(targetKeys).size !== 375 || targetKeys.some((key) => !key.includes("|"))) {
    throw new InstaCompJobServerError(
      "The recovery payload must contain the exact 375 audited checklist targets.",
      409,
      "SENTINEL_RECOVERY_TARGET_MISMATCH",
    );
  }

  const runResponse = await fetch(
    `https://api.github.com/repos/${GITHUB_RECOVERY_REPO}/actions/runs/${runId}`,
    {
      headers: githubHeaders(token),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    },
  );
  const run = (await runResponse.json().catch(() => null)) as
    | {
        name?: unknown;
        event?: unknown;
        status?: unknown;
        head_branch?: unknown;
        repository?: { full_name?: unknown };
        head_repository?: { full_name?: unknown };
      }
    | null;
  if (
    !runResponse.ok ||
    !run ||
    run.name !== GITHUB_RECOVERY_WORKFLOW ||
    run.event !== "pull_request" ||
    run.status !== "in_progress" ||
    run.head_branch !== GITHUB_RECOVERY_BRANCH ||
    run.repository?.full_name !== GITHUB_RECOVERY_REPO ||
    run.head_repository?.full_name !== GITHUB_RECOVERY_REPO
  ) {
    throw new InstaCompJobServerError(
      "GitHub recovery run identity was rejected.",
      403,
      "SENTINEL_GITHUB_RECOVERY_REJECTED",
    );
  }

  const targetFileResponse = await fetch(
    `https://api.github.com/repos/${GITHUB_RECOVERY_REPO}/contents/${GITHUB_RECOVERY_TARGET_PATH}?ref=main`,
    {
      headers: githubHeaders(token),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    },
  );
  const targetFile = (await targetFileResponse.json().catch(() => null)) as
    | { content?: unknown; encoding?: unknown }
    | null;
  if (!targetFileResponse.ok || !targetFile || targetFile.encoding !== "base64") {
    throw new InstaCompJobServerError(
      "The audited recovery target file could not be verified against main.",
      502,
      "SENTINEL_RECOVERY_TARGET_FILE_UNAVAILABLE",
    );
  }
  const encoded = String(targetFile.content || "").replace(/\s+/g, "");
  const expectedKeys = recoveryTargetKeysFromText(Buffer.from(encoded, "base64").toString("utf8"));
  if (expectedKeys.length !== 375 || new Set(expectedKeys).size !== 375 || !exactStringArrayEqual(targetKeys, expectedKeys)) {
    throw new InstaCompJobServerError(
      "Recovery payload does not exactly match the audited target file on main.",
      409,
      "SENTINEL_RECOVERY_TARGET_MISMATCH",
    );
  }

  return expectedKeys;
}

function errorResponse(error: unknown) {
  if (error instanceof InstaCompJobServerError) {
    return response({ ok: false, code: error.code, error: error.message }, error.status);
  }
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    Number.isInteger(Number((error as { status?: unknown }).status))
  ) {
    const value = error as { status?: unknown; code?: unknown; message?: unknown };
    return response(
      {
        ok: false,
        code: String(value.code || "SENTINEL_REQUEST_REJECTED"),
        error: String(value.message || "Sentinel request rejected."),
      },
      Number(value.status),
    );
  }
  const name = error instanceof Error ? error.name : "UnknownError";
  const timeout = name === "TimeoutError" || name === "AbortError";
  return response(
    {
      ok: false,
      code: timeout ? "SENTINEL_MAC_TIMEOUT" : "SENTINEL_PROXY_FAILED",
      error: timeout
        ? "The Mac did not answer before the secure proxy timeout."
        : "The secure Sentinel proxy could not reach the Mac.",
    },
    503,
  );
}

export async function GET(request: Request) {
  try {
    const view = new URL(request.url).searchParams.get("view") || "status";
    const installerStatusProbe =
      view === "status" && isValidInstaCompSentinelArchiveRequest(request);
    if (!installerStatusProbe) await requireAdmin(request);
    const path = GET_PATHS[view];
    if (!path) return response({ ok: false, error: "Unknown Sentinel view." }, 400);
    return response({ ok: true, view, data: await callMac(path) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      githubRunId?: unknown;
      targetKeys?: unknown;
    };
    const action = String(body.action || "");

    if (action === "requeue-audited-recovery") {
      const targetKeys = await requireTrustedGitHubRecoveryRun(request, body);
      const refreshed = await callMac("/v1/checklist-sentinel/refresh-targets", {
        method: "POST",
        body: "{}",
      });
      const requeued = await callMac("/v1/checklist-sentinel/requeue-targets", {
        method: "POST",
        body: JSON.stringify({ target_keys: targetKeys, priority: 1 }),
      });
      return response({
        ok: true,
        action,
        githubRunId: Number(body.githubRunId),
        auditedTargetCount: targetKeys.length,
        refreshed,
        requeued,
      });
    }

    const actor = await requireAdmin(request);
    assertTrustedInstaCompMutationRequest({ request, actor });
    if (action === "run") {
      const data = await callMac("/v1/checklist-sentinel/run", {
        method: "POST",
        body: JSON.stringify({ trigger: "website-admin" }),
      });
      return response({ ok: true, action, data });
    }
    if (action === "refresh-targets") {
      const data = await callMac("/v1/checklist-sentinel/refresh-targets", {
        method: "POST",
        body: "{}",
      });
      return response({ ok: true, action, data });
    }
    return response({ ok: false, error: "Unknown Sentinel action." }, 400);
  } catch (error) {
    return errorResponse(error);
  }
}
