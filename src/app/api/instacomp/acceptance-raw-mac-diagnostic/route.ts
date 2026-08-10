import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function response(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function exactSecretMatch(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function requireAcceptanceToken(request: Request) {
  const expected = String(process.env.INSTACOMP_ACCEPTANCE_SERVICE_TOKEN || "").trim();
  const supplied = String(request.headers.get("x-tcos-instacomp-service-token") || "").trim();
  if (!expected || !exactSecretMatch(expected, supplied)) throw new Error("acceptance_token_rejected");
}

function boundedText(value: string, limit = 4000) {
  return String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "?").slice(0, limit);
}

async function readBody(res: Response) {
  const raw = await res.text();
  try { return { kind: "json", value: raw ? JSON.parse(raw) : null }; }
  catch { return { kind: "text", value: boundedText(raw) }; }
}

export async function POST(request: Request) {
  try {
    requireAcceptanceToken(request);
    const localUrl = String(process.env.INSTACOMP_AI_LOCAL_URL || "").trim().replace(/\/+$/, "");
    const localKey = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
    if (!/^https:\/\//i.test(localUrl) || !localKey) {
      return response({ ok: false, code: "LOCAL_RUNTIME_CONFIG_UNAVAILABLE", has_local_url: Boolean(localUrl), has_local_key: Boolean(localKey) }, 503);
    }
    const form = await request.formData();
    const front = form.get("front");
    const back = form.get("back");
    if (!(front instanceof File) || !(back instanceof File)) return response({ ok: false, code: "DIAGNOSTIC_IMAGES_REQUIRED" }, 400);
    for (const [side, file] of [["front", front], ["back", back]] as const) {
      if (!ALLOWED_IMAGE_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) return response({ ok: false, code: "DIAGNOSTIC_IMAGE_REJECTED", side }, 400);
    }
    const authHeaders = { "X-InstaComp-AI-Key": localKey };
    const [healthRes, doctorRes] = await Promise.all([
      fetch(`${localUrl}/health`, { cache: "no-store", signal: AbortSignal.timeout(30_000) }),
      fetch(`${localUrl}/v1/control/doctor`, { headers: authHeaders, cache: "no-store", signal: AbortSignal.timeout(90_000) }),
    ]);
    const healthBody = await readBody(healthRes);
    const doctorBody = await readBody(doctorRes);
    const macForm = new FormData();
    macForm.append("front", front, "front.jpg");
    macForm.append("back", back, "back.jpg");
    const startedAt = Date.now();
    const scanRes = await fetch(`${localUrl}/v1/scans/analyze`, { method: "POST", headers: authHeaders, body: macForm, cache: "no-store", signal: AbortSignal.timeout(240_000) });
    const scanBody = await readBody(scanRes);
    return response({
      ok: true,
      schema_version: "tcos.instacomp-ai.acceptance-raw-mac-diagnostic.v1",
      runtime_config_present: true,
      health: { http_status: healthRes.status, http_ok: healthRes.ok, body: healthBody },
      system_doctor: { http_status: doctorRes.status, http_ok: doctorRes.ok, body: doctorBody },
      scan: { http_status: scanRes.status, http_ok: scanRes.ok, duration_ms: Date.now() - startedAt, body: scanBody },
      local_url_exposed: false,
      local_key_exposed: false,
      nothing_published: true,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "acceptance_token_rejected") return response({ ok: false, code: "ACCEPTANCE_TOKEN_REJECTED" }, 403);
    return response({ ok: false, code: "RAW_MAC_DIAGNOSTIC_FAILED", error_name: error instanceof Error ? error.name.slice(0, 120) : "UnknownError", error: error instanceof Error ? boundedText(error.message, 1000) : "diagnostic_failed" }, 502);
  }
}
