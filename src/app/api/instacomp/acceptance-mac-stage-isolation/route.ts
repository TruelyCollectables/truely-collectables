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
    set_name: identity.set_name || null,
    subset: identity.subset || null,
    card_number: identity.card_number || null,
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

function normalized(value: unknown) {
  return String(value || "").trim().toLowerCase();
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

    const trustedCandidates = examples.filter((row) => {
      const item = objectValue(row);
      const identity = objectValue(item?.confirmed_identity);
      return Boolean(
        item?.trusted === true &&
        item?.scan_id &&
        item?.front_sha256 &&
        item?.back_sha256 &&
        normalized(identity?.player) === "sonia citron" &&
        normalized(identity?.card_number) === "122",
      );
    }).slice(0, 25) as Record<string, unknown>[];

    let trustedControl: Record<string, unknown> = {
      purpose: "exact_trusted_memory_then_live_registry_then_fresh_local_vision_before_reader",
      source_found: false,
      candidate_count: trustedCandidates.length,
      mutation_contract: "expected_scan_event_only_no_new_lesson_no_inventory_publication",
    };

    for (const candidate of trustedCandidates) {
      const scanId = String(candidate.scan_id || "").trim();
      if (!scanId) continue;
      const encodedScanId = encodeURIComponent(scanId);
      const [sourceFrontRes, sourceBackRes] = await Promise.all([
        fetch(`${localUrl}/v1/scans/${encodedScanId}/images/front`, {
          headers: authHeaders,
          cache: "no-store",
          signal: AbortSignal.timeout(90_000),
        }),
        fetch(`${localUrl}/v1/scans/${encodedScanId}/images/back`, {
          headers: authHeaders,
          cache: "no-store",
          signal: AbortSignal.timeout(90_000),
        }),
      ]);
      if (!sourceFrontRes.ok || !sourceBackRes.ok) continue;

      const [sourceFrontBytes, sourceBackBytes] = await Promise.all([
        sourceFrontRes.arrayBuffer(),
        sourceBackRes.arrayBuffer(),
      ]);
      const controlStartedAt = Date.now();
      const controlRes = await fetch(`${localUrl}/v1/scans/analyze`, {
        method: "POST",
        headers: authHeaders,
        body: imageForm(sourceFrontBytes, sourceBackBytes),
        cache: "no-store",
        signal: AbortSignal.timeout(240_000),
      });
      const controlBody = await readBody(controlRes);
      trustedControl = {
        purpose: "exact_trusted_memory_then_live_registry_then_fresh_local_vision_before_reader",
        source_found: true,
        candidate_count: trustedCandidates.length,
        source_training_example_id: candidate.training_example_id || null,
        source_scan_id: scanId,
        source_card_uuid_present: Boolean(candidate.card_uuid),
        source_verification_source: candidate.verification_source || null,
        source_registry_identity_id_present: Boolean(candidate.registry_identity_id),
        source_registry_fingerprint_present: Boolean(candidate.registry_fingerprint_sha256),
        source_identity: compactIdentity(candidate),
        archived_front_http_status: sourceFrontRes.status,
        archived_back_http_status: sourceBackRes.status,
        analyze_http_status: controlRes.status,
        analyze_http_ok: controlRes.ok,
        analyze_duration_ms: Date.now() - controlStartedAt,
        analyze_body: compactAnalyzeBody(controlBody),
        mutation_contract: "expected_scan_event_only_no_new_lesson_no_inventory_publication",
      };
      break;
    }

    const examplesAfterRes = await fetch(`${localUrl}/v1/training/examples?trusted_only=true&limit=5000`, {
      headers: authHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
    const examplesAfterRaw = await examplesAfterRes.json().catch(() => null) as null | { examples?: unknown[]; count?: number };
    const examplesAfterList = Array.isArray(examplesAfterRaw?.examples) ? examplesAfterRaw.examples : [];
    const examplesAfter = Number(examplesAfterRaw?.count || examplesAfterList.length || 0);
    trustedControl.trusted_example_count_before = examplesBefore;
    trustedControl.trusted_example_count_after = examplesAfter;
    trustedControl.no_new_trusted_lesson = examplesBefore === examplesAfter;

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
      schema_version: "tcos.instacomp-ai.acceptance-mac-stage-isolation.v5",
      exact_frozen_raw_hashes_expected: true,
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
      trusted_memory_fresh_vision_control: trustedControl,
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
      diagnostic_local_mutation: "trusted-memory control may create one rescan event only; trusted-example count is compared before/after; no inventory publication; failing frozen analyze remains unchanged",
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
