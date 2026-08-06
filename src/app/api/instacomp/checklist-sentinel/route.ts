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
    const actor = await requireAdmin(request);
    assertTrustedInstaCompMutationRequest({ request, actor });
    const body = (await request.json().catch(() => ({}))) as { action?: unknown };
    const action = String(body.action || "");
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
