import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const SONIA_RAW_FRONT_SHA256 = "eaacec37493b419f1d397df739aedd9df218639ded876c481b2fb28b2b3eb2b1";
const SONIA_RAW_BACK_SHA256 = "3ecd070456e09342ed83ca88193ed2d029cd8a77ed5b2e2ae1ce443e9866978c";
const SONIA_NORMALIZED_FRONT_SHA256 = "9dac4f6e94ff5d2180c0dda73008ec46f214dfde2cd59314493186ce1b5dc46d";
const SONIA_NORMALIZED_BACK_SHA256 = "5feb7d055f8ba36c6b8f6e8ad9622d1587d1267614d9ce9c2bfb841f04ff20e8";

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
  return supplied;
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

function compactIdentityValue(identityValue: unknown) {
  const identity = objectValue(identityValue);
  return identity ? {
    player: identity.player || null,
    year: identity.year || null,
    manufacturer: identity.manufacturer || null,
    brand: identity.brand || null,
    set_name: identity.set_name || identity.setName || null,
    subset: identity.subset || null,
    card_number: identity.card_number || identity.cardNumber || null,
    parallel: identity.parallel || null,
  } : null;
}

function compactIdentity(example: Record<string, unknown> | undefined) {
  return compactIdentityValue(example?.confirmed_identity);
}

function compactMemorySearchBody(body: Awaited<ReturnType<typeof readBody>>) {
  if (body.kind !== "json") return body;
  const value = objectValue(body.value);
  const matches = Array.isArray(value?.matches) ? value.matches : [];
  return {
    kind: "json" as const,
    value: {
      schema_version: value?.schema_version || null,
      match_count: matches.length,
      first_match: matches.length ? (() => {
        const match = objectValue(matches[0]);
        return {
          score: match?.score || null,
          verification_state: match?.verification_state || null,
          verification_source: match?.verification_source || null,
          identity: compactIdentityValue(match?.identity),
        };
      })() : null,
    },
  };
}

function compactAnalyzeBody(body: Awaited<ReturnType<typeof readBody>>) {
  if (body.kind !== "json") return body;
  const value = objectValue(body.value);
  const checklist = objectValue(value?.checklist);
  const localVision = objectValue(value?.local_vision);
  const identityHints = objectValue(localVision?.identity_hints);
  return {
    kind: "json" as const,
    value: {
      schema_version: value?.schema_version || null,
      status: value?.status || null,
      match_source: value?.match_source || null,
      pricing_allowed: value?.pricing_allowed ?? null,
      learning_allowed: value?.learning_allowed ?? null,
      trusted_identity: compactIdentityValue(value?.trusted_identity),
      checklist: checklist ? {
        outcome: checklist.outcome || null,
        identity_id: checklist.identity_id || null,
        source_receipts: Array.isArray(checklist.source_receipts) ? checklist.source_receipts : [],
      } : null,
      local_vision_present: Boolean(localVision),
      apple_vision_available: localVision?.apple_vision_available ?? null,
      opencv_available: localVision?.opencv_available ?? null,
      local_identity_hints: identityHints ? compactIdentityValue(identityHints) : null,
      local_suggestion_present: Boolean(value?.local_suggestion),
      next_action: typeof value?.next_action === "string" ? boundedText(value.next_action, 700) : null,
    },
  };
}

function compactRegistryBody(body: Awaited<ReturnType<typeof readBody>>) {
  if (body.kind !== "json") return body;
  const value = objectValue(body.value);
  const locked = objectValue(value?.lockedFields);
  return {
    kind: "json" as const,
    value: {
      ok: value?.ok ?? null,
      status: value?.status || null,
      registry_identity_id_present: Boolean(value?.registryIdentityId || value?.identityId),
      registry_fingerprint_present: Boolean(value?.registryFingerprintSha256 || value?.fingerprintSha256),
      candidate_count: value?.candidateCount ?? null,
      identification_path: value?.identificationPath || null,
      locked_identity: compactIdentityValue(locked),
      error: typeof value?.error === "string" ? boundedText(value.error, 700) : null,
    },
  };
}

async function registryControl(params: {
  origin: string;
  acceptanceToken: string;
  label: string;
  parallel: string | null;
}) {
  const startedAt = Date.now();
  const res = await fetch(`${params.origin}/api/instacomp/checklist-lookup`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tcos-instacomp-service-token": params.acceptanceToken,
    },
    body: JSON.stringify({
      year: "2025",
      manufacturer: "Panini",
      brand: "Panini Prizm WNBA",
      setName: "Base",
      cardNumber: "122",
      player: "Sonia Citron",
      parallel: params.parallel,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(90_000),
  });
  const body = await readBody(res);
  return {
    label: params.label,
    http_status: res.status,
    http_ok: res.ok,
    duration_ms: Date.now() - startedAt,
    body: compactRegistryBody(body),
    mutation: false,
  };
}

function normalized(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export async function POST(request: Request) {
  try {
    const acceptanceToken = requireAcceptanceToken(request);
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
    const origin = new URL(request.url).origin;

    const [registryBaseControl, registryParallelControl] = await Promise.all([
      registryControl({
        origin,
        acceptanceToken,
        label: "frozen_sonia_122_base",
        parallel: null,
      }),
      registryControl({
        origin,
        acceptanceToken,
        label: "trusted_sonia_122_orange_cracked_ice",
        parallel: "Orange Cracked Ice Prizm",
      }),
    ]);

    const examplesRes = await fetch(`${localUrl}/v1/training/examples?trusted_only=true&limit=5000`, {
      headers: authHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
    const examplesRaw = await examplesRes.json().catch(() => null) as null | { examples?: unknown[]; count?: number };
    const examples = Array.isArray(examplesRaw?.examples) ? examplesRaw.examples : [];
    const examplesBefore = Number(examplesRaw?.count || examples.length || 0);
    const rawHashExample = examples.find((row) => {
      const item = objectValue(row);
      return item?.front_sha256 === SONIA_RAW_FRONT_SHA256 && item?.back_sha256 === SONIA_RAW_BACK_SHA256;
    }) as Record<string, unknown> | undefined;
    const normalizedExample = examples.find((row) => {
      const item = objectValue(row);
      return item?.front_sha256 === SONIA_NORMALIZED_FRONT_SHA256 && item?.back_sha256 === SONIA_NORMALIZED_BACK_SHA256;
    }) as Record<string, unknown> | undefined;

    const memorySearchStartedAt = Date.now();
    const memorySearchRes = await fetch(
      `${localUrl}/v1/lessons/search?player=${encodeURIComponent("Sonia Citron")}&card_number=122&limit=10`,
      {
        headers: authHeaders,
        cache: "no-store",
        signal: AbortSignal.timeout(90_000),
      },
    );
    const memorySearchBody = await readBody(memorySearchRes);
    const memorySearchDurationMs = Date.now() - memorySearchStartedAt;

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
      schema_version: "tcos.instacomp-ai.acceptance-mac-stage-isolation.v6",
      exact_frozen_raw_hashes_expected: true,
      direct_registry_controls: {
        purpose: "exercise_production_checklist_registry_without_mac_scan_or_lesson_mutation",
        base: registryBaseControl,
        named_parallel: registryParallelControl,
      },
      trusted_training_readback: {
        http_status: examplesRes.status,
        http_ok: examplesRes.ok,
        total_trusted_examples: examplesBefore,
        raw_artifact_hash_pair_present: Boolean(rawHashExample),
        normalized_hashes_from_prior_proven_archive_stage: {
          front_sha256: SONIA_NORMALIZED_FRONT_SHA256,
          back_sha256: SONIA_NORMALIZED_BACK_SHA256,
        },
        exact_frozen_pair_present: Boolean(normalizedExample),
        exact_pair_card_uuid_present: Boolean(normalizedExample?.card_uuid),
        exact_pair_identity: compactIdentity(normalizedExample),
      },
      trusted_lesson_search_control: {
        purpose: "exercise_the_same_store_search_called_after_reader_without_mutation",
        http_status: memorySearchRes.status,
        http_ok: memorySearchRes.ok,
        duration_ms: memorySearchDurationMs,
        body: compactMemorySearchBody(memorySearchBody),
        mutation: false,
      },
      full_analyze_stage: {
        http_status: analyzeRes.status,
        http_ok: analyzeRes.ok,
        duration_ms: analyzeDurationMs,
        body: compactAnalyzeBody(analyzeBody),
      },
      local_source_changed: false,
      scanner_logic_changed: false,
      registry_truth_changed: false,
      frozen_truth_changed: false,
      local_url_exposed: false,
      local_key_exposed: false,
      diagnostic_local_mutation: "none beyond the unchanged failing frozen analyze scan attempt; Registry controls and lesson search are read-only; no lesson or inventory publication",
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
