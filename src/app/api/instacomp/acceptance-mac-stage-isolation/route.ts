import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const SONIA_RAW_FRONT_SHA256 = "eaacec37493b419f1d397df739aedd9df218639ded876c481b2fb28b2b3eb2b1";
const SONIA_RAW_BACK_SHA256 = "3ecd070456e09342ed83ca88193ed2d029cd8a77ed5b2e2ae1ce443e9866978c";

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
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "?")
    .slice(0, limit);
}

async function readBody(res: Response) {
  const raw = await res.text();
  try {
    return { kind: "json" as const, value: raw ? JSON.parse(raw) : null };
  } catch {
    return { kind: "text" as const, value: boundedText(raw) };
  }
}

function imageForm(frontBytes: ArrayBuffer, backBytes: ArrayBuffer) {
  const form = new FormData();
  form.append("front", new Blob([frontBytes], { type: "image/jpeg" }), "front.jpg");
  form.append("back", new Blob([backBytes], { type: "image/jpeg" }), "back.jpg");
  return form;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function compactIdentity(example: Record<string, unknown> | undefined) {
  const identity = objectValue(example?.confirmed_identity);
  return identity ? {
    player: identity.player || null,
    year: identity.year || null,
    manufacturer: identity.manufacturer || null,
    brand: identity.brand || null,
    set_name: identity.set_name || null,
    subset: identity.subset || null,
    card_number: identity.card_number || null,
    parallel: identity.parallel || null,
  } : null;
}

export async function POST(request: Request) {
  try {
    requireAcceptanceToken(request);
    const localUrl = String(process.env.INSTACOMP_AI_LOCAL_URL || "").trim().replace(/\/+$/, "");
    const localKey = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
    if (!/^https:\/\//i.test(localUrl) || !localKey) {
      return response({ ok: false, code: "LOCAL_RUNTIME_CONFIG_UNAVAILABLE" }, 503);
    }

    const form = await request.formData();
    const front = form.get("front");
    const back = form.get("back");
    if (!(front instanceof File) || !(back instanceof File)) {
      return response({ ok: false, code: "DIAGNOSTIC_IMAGES_REQUIRED" }, 400);
    }
    if (front.size <= 0 || back.size <= 0 || front.size > MAX_IMAGE_BYTES || back.size > MAX_IMAGE_BYTES) {
      return response({ ok: false, code: "DIAGNOSTIC_IMAGE_REJECTED" }, 400);
    }

    const [frontBytes, backBytes] = await Promise.all([
      front.arrayBuffer(),
      back.arrayBuffer(),
    ]);
    const authHeaders = { "X-InstaComp-AI-Key": localKey };

    const examplesRes = await fetch(`${localUrl}/v1/training/examples?trusted_only=true&limit=5000`, {
      headers: authHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
    const examplesRaw = await examplesRes.json().catch(() => null) as null | { examples?: unknown[]; count?: number };
    const examples = Array.isArray(examplesRaw?.examples) ? examplesRaw.examples : [];
    const rawHashExample = examples.find((row) => {
      const item = objectValue(row);
      return item?.front_sha256 === SONIA_RAW_FRONT_SHA256 && item?.back_sha256 === SONIA_RAW_BACK_SHA256;
    }) as Record<string, unknown> | undefined;

    const archiveStartedAt = Date.now();
    const archiveRes = await fetch(`${localUrl}/v1/scans/supervised-archive`, {
      method: "POST",
      headers: authHeaders,
      body: imageForm(frontBytes, backBytes),
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    const archiveBody = await readBody(archiveRes);
    const archiveDurationMs = Date.now() - archiveStartedAt;
    const archiveValue = archiveBody.kind === "json" ? objectValue(archiveBody.value) : null;
    const normalizedFrontSha = typeof archiveValue?.front_sha256 === "string" ? archiveValue.front_sha256 : null;
    const normalizedBackSha = typeof archiveValue?.back_sha256 === "string" ? archiveValue.back_sha256 : null;
    const normalizedExample = normalizedFrontSha && normalizedBackSha
      ? examples.find((row) => {
          const item = objectValue(row);
          return item?.front_sha256 === normalizedFrontSha && item?.back_sha256 === normalizedBackSha;
        }) as Record<string, unknown> | undefined
      : undefined;

    const analyzeStartedAt = Date.now();
    const analyzeRes = await fetch(`${localUrl}/v1/scans/analyze`, {
      method: "POST",
      headers: authHeaders,
      body: imageForm(frontBytes, backBytes),
      cache: "no-store",
      signal: AbortSignal.timeout(240_000),
    });
    const analyzeBody = await readBody(analyzeRes);
    const analyzeDurationMs = Date.now() - analyzeStartedAt;

    return response({
      ok: true,
      schema_version: "tcos.instacomp-ai.acceptance-mac-stage-isolation.v2",
      exact_frozen_raw_hashes_expected: true,
      trusted_training_readback: {
        http_status: examplesRes.status,
        http_ok: examplesRes.ok,
        total_trusted_examples: Number(examplesRaw?.count || examples.length || 0),
        raw_artifact_hash_pair_present: Boolean(rawHashExample),
        normalized_hashes_from_mac: {
          front_sha256: normalizedFrontSha,
          back_sha256: normalizedBackSha,
        },
        exact_frozen_pair_present: Boolean(normalizedExample),
        exact_pair_card_uuid_present: Boolean(normalizedExample?.card_uuid),
        exact_pair_identity: compactIdentity(normalizedExample),
      },
      supervised_archive_stage: {
        purpose: "image_validation_persistence_exact_pair_uuid_and_scan_storage_only",
        http_status: archiveRes.status,
        http_ok: archiveRes.ok,
        duration_ms: archiveDurationMs,
        body: archiveBody,
        creates_identity: false,
        publishes_inventory: false,
      },
      full_analyze_stage: {
        http_status: analyzeRes.status,
        http_ok: analyzeRes.ok,
        duration_ms: analyzeDurationMs,
        body: analyzeBody,
      },
      local_source_changed: false,
      scanner_logic_changed: false,
      registry_truth_changed: false,
      frozen_truth_changed: false,
      local_url_exposed: false,
      local_key_exposed: false,
      diagnostic_local_mutation: "one supervised archive scan row only; no identity lesson and no inventory publication",
      nothing_published: true,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "acceptance_token_rejected") {
      return response({ ok: false, code: "ACCEPTANCE_TOKEN_REJECTED" }, 403);
    }
    return response({
      ok: false,
      code: "MAC_STAGE_ISOLATION_FAILED",
      error_name: error instanceof Error ? error.name.slice(0, 120) : "UnknownError",
      error: error instanceof Error ? boundedText(error.message, 1000) : "diagnostic_failed",
    }, 502);
  }
}
