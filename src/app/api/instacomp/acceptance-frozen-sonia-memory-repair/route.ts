import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const EXPECTED_MAC_HOST = "instacomp.truelycollectables.com";
const SONIA_RAW_FRONT_SHA256 = "eaacec37493b419f1d397df739aedd9df218639ded876c481b2fb28b2b3eb2b1";
const SONIA_RAW_BACK_SHA256 = "3ecd070456e09342ed83ca88193ed2d029cd8a77ed5b2e2ae1ce443e9866978c";
const SONIA_NORMALIZED_FRONT_SHA256 = "9dac4f6e94ff5d2180c0dda73008ec46f214dfde2cd59314493186ce1b5dc46d";
const SONIA_NORMALIZED_BACK_SHA256 = "5feb7d055f8ba36c6b8f6e8ad9622d1587d1267614d9ce9c2bfb841f04ff20e8";
const SONIA_REGISTRY_ID = "2a7d4ddd-e9f7-4ce2-904c-b1a17b33ae4f";
const SONIA_REGISTRY_FINGERPRINT = "4366f96b6cf8b136e5ae4da70c35539d56e1793de0a42bcccbf970a892791e59";
const REGISTRY_PROOF_ARTIFACT_ID = "9069262233";

type JsonObject = Record<string, unknown>;

function response(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function exactSecretMatch(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function requireAcceptanceToken(request: Request) {
  const expected = String(process.env.INSTACOMP_ACCEPTANCE_SERVICE_TOKEN || "").trim();
  const supplied = String(request.headers.get("x-tcos-instacomp-service-token") || "").trim();
  if (!expected || !exactSecretMatch(expected, supplied)) {
    throw new Error("acceptance_token_rejected");
  }
  return supplied;
}

function sha256(bytes: ArrayBuffer) {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function boundedText(value: unknown, limit = 800) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "?")
    .slice(0, limit);
}

async function jsonBody(res: Response) {
  const raw = await res.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`non_json_http_${res.status}:${boundedText(raw, 300)}`);
  }
}

function imageForm(frontBytes: ArrayBuffer, backBytes: ArrayBuffer) {
  const form = new FormData();
  form.append("front", new Blob([frontBytes], { type: "image/jpeg" }), "front.jpg");
  form.append("back", new Blob([backBytes], { type: "image/jpeg" }), "back.jpg");
  return form;
}

function compactIdentity(value: unknown) {
  const identity = objectValue(value);
  return identity
    ? {
        player: identity.player || null,
        year: identity.year || null,
        manufacturer: identity.manufacturer || null,
        brand: identity.brand || null,
        set_name: identity.set_name || identity.setName || null,
        card_number: identity.card_number || identity.cardNumber || null,
        parallel: identity.parallel || null,
        team: identity.team || null,
      }
    : null;
}

function exactCorrectedExample(value: unknown) {
  const example = objectValue(value);
  if (!example) return false;
  const identity = objectValue(example.confirmed_identity);
  return (
    example.front_sha256 === SONIA_NORMALIZED_FRONT_SHA256 &&
    example.back_sha256 === SONIA_NORMALIZED_BACK_SHA256 &&
    identity?.player === "Sonia Citron" &&
    String(identity?.card_number || "") === "122" &&
    identity?.parallel === "Base" &&
    example.trusted === true
  );
}

export async function POST(request: Request) {
  let stage = "acceptance_auth";
  let archiveCreated = false;
  let lessonCreated = false;

  try {
    const acceptanceToken = requireAcceptanceToken(request);
    const configuredUrl = String(process.env.INSTACOMP_AI_LOCAL_URL || "").trim().replace(/\/+$/, "");
    const localKey = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
    if (!configuredUrl || !localKey) {
      return response({ ok: false, code: "LOCAL_RUNTIME_CONFIG_UNAVAILABLE" }, 503);
    }
    const local = new URL(configuredUrl);
    if (
      local.protocol !== "https:" ||
      local.hostname !== EXPECTED_MAC_HOST ||
      local.username ||
      local.password
    ) {
      return response({ ok: false, code: "LOCAL_RUNTIME_URL_REJECTED" }, 503);
    }

    const input = await request.formData();
    const front = input.get("front");
    const back = input.get("back");
    if (!(front instanceof File) || !(back instanceof File)) {
      return response({ ok: false, code: "FROZEN_IMAGES_REQUIRED" }, 400);
    }
    if (
      front.size <= 0 ||
      back.size <= 0 ||
      front.size > MAX_IMAGE_BYTES ||
      back.size > MAX_IMAGE_BYTES
    ) {
      return response({ ok: false, code: "FROZEN_IMAGE_REJECTED" }, 400);
    }
    const [frontBytes, backBytes] = await Promise.all([
      front.arrayBuffer(),
      back.arrayBuffer(),
    ]);
    if (
      sha256(frontBytes) !== SONIA_RAW_FRONT_SHA256 ||
      sha256(backBytes) !== SONIA_RAW_BACK_SHA256
    ) {
      return response({ ok: false, code: "FROZEN_IMAGE_HASH_MISMATCH" }, 409);
    }

    const origin = new URL(request.url).origin;
    const macHeaders = { "X-InstaComp-AI-Key": localKey };

    stage = "registry_revalidation";
    const registryRes = await fetch(`${origin}/api/instacomp/checklist-lookup`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tcos-instacomp-service-token": acceptanceToken,
      },
      body: JSON.stringify({
        year: "2025",
        manufacturer: "Panini",
        brand: "Panini Prizm WNBA",
        setName: "Base",
        cardNumber: "122",
        player: "Sonia Citron",
        parallel: "Base",
        isAuto: false,
        isRelic: false,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
    const registry = objectValue(await jsonBody(registryRes));
    const registryId = String(registry?.registryIdentityId || registry?.identityId || "");
    const registryFingerprint = String(
      registry?.registryFingerprintSha256 || registry?.fingerprintSha256 || "",
    ).toLowerCase();
    if (
      !registryRes.ok ||
      registry?.ok !== true ||
      registry?.status !== "exact_match" ||
      registry?.aiRequired !== false ||
      registry?.candidateCount !== 1 ||
      registryId !== SONIA_REGISTRY_ID ||
      registryFingerprint !== SONIA_REGISTRY_FINGERPRINT
    ) {
      throw new Error("immutable_registry_revalidation_failed");
    }

    stage = "mac_authenticated_read";
    const controlRes = await fetch(`${configuredUrl}/v1/control/status`, {
      headers: macHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    const control = objectValue(await jsonBody(controlRes));
    if (
      !controlRes.ok ||
      control?.database !== "ready" ||
      control?.central_registry !== "ready"
    ) {
      throw new Error(`mac_control_not_ready_http_${controlRes.status}`);
    }

    stage = "trusted_example_readback";
    const examplesRes = await fetch(
      `${configuredUrl}/v1/training/examples?trusted_only=true&limit=5000`,
      {
        headers: macHeaders,
        cache: "no-store",
        signal: AbortSignal.timeout(90_000),
      },
    );
    const examplesBody = objectValue(await jsonBody(examplesRes));
    if (!examplesRes.ok) {
      throw new Error(`trusted_examples_http_${examplesRes.status}`);
    }
    const examples = Array.isArray(examplesBody?.examples) ? examplesBody.examples : [];
    const existingCorrected = examples.find(exactCorrectedExample);

    let correctionReceipt: JsonObject = {
      performed: false,
      reason: "exact_frozen_base_memory_already_present",
      existing_identity: existingCorrected
        ? compactIdentity(objectValue(existingCorrected)?.confirmed_identity)
        : null,
    };

    if (!existingCorrected) {
      stage = "supervised_archive";
      const archiveRes = await fetch(`${configuredUrl}/v1/scans/supervised-archive`, {
        method: "POST",
        headers: macHeaders,
        body: imageForm(frontBytes, backBytes),
        cache: "no-store",
        signal: AbortSignal.timeout(120_000),
      });
      const archive = objectValue(await jsonBody(archiveRes));
      if (
        !archiveRes.ok ||
        !archive?.scan_id ||
        archive?.identity_created !== false ||
        archive?.nothing_published !== true ||
        archive?.front_sha256 !== SONIA_NORMALIZED_FRONT_SHA256 ||
        archive?.back_sha256 !== SONIA_NORMALIZED_BACK_SHA256
      ) {
        throw new Error(`supervised_archive_failed_http_${archiveRes.status}`);
      }
      archiveCreated = true;

      stage = "operator_confirmed_lesson";
      const lessonRes = await fetch(`${configuredUrl}/v1/lessons`, {
        method: "POST",
        headers: {
          ...macHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          scan_id: archive.scan_id,
          state: "operator_confirmed",
          identity: {
            sport: "Basketball",
            league: "WNBA",
            year: "2025",
            manufacturer: "Panini",
            brand: "Prizm",
            set_name: "Base",
            player: "Sonia Citron",
            team: "Washington Mystics",
            card_number: "122",
            parallel: "Base",
            autograph: false,
            memorabilia: false,
          },
          verification_source: `frozen_acceptance_v8_registry:${SONIA_REGISTRY_ID}`,
          operator_id: "tcos_frozen_truth_repair_20260810",
          notes:
            `Exact frozen-image correction after immutable Production Registry proof artifact ${REGISTRY_PROOF_ARTIFACT_ID}; ` +
            `Registry UUID ${SONIA_REGISTRY_ID}; fingerprint ${SONIA_REGISTRY_FINGERPRINT}. ` +
            "No inventory, pricing, publishing, model, or runtime-source mutation.",
          rejected_identity: {
            year: "2025",
            manufacturer: "Panini",
            brand: "Panini Prizm WNBA",
            set_name: "Base",
            player: "Sonia Citron",
            card_number: "122",
            parallel: "Orange Cracked Ice Prizm",
          },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(90_000),
      });
      const lesson = objectValue(await jsonBody(lessonRes));
      if (
        !lessonRes.ok ||
        lesson?.state !== "operator_confirmed" ||
        lesson?.trusted !== true ||
        !lesson?.lesson_id ||
        !lesson?.training_example_id ||
        objectValue(lesson?.identity)?.player !== "Sonia Citron" ||
        String(objectValue(lesson?.identity)?.card_number || "") !== "122" ||
        objectValue(lesson?.identity)?.parallel !== "Base"
      ) {
        throw new Error(`corrected_lesson_failed_http_${lessonRes.status}`);
      }
      lessonCreated = true;
      correctionReceipt = {
        performed: true,
        archive_scan_id: archive.scan_id,
        card_uuid: archive.card_uuid || null,
        image_pair_sha256: archive.image_pair_sha256 || null,
        lesson_id: lesson.lesson_id,
        training_example_id: lesson.training_example_id,
        identity: compactIdentity(lesson.identity),
        rejected_identity: compactIdentity(lesson.rejected_identity),
        nothing_published: true,
      };
    }

    stage = "post_correction_analyze";
    const analyzeRes = await fetch(`${configuredUrl}/v1/scans/analyze`, {
      method: "POST",
      headers: macHeaders,
      body: imageForm(frontBytes, backBytes),
      cache: "no-store",
      signal: AbortSignal.timeout(240_000),
    });
    const analyze = objectValue(await jsonBody(analyzeRes));
    const checklist = objectValue(analyze?.checklist);
    const trustedIdentity = objectValue(analyze?.trusted_identity);
    const receipts = Array.isArray(checklist?.source_receipts)
      ? checklist.source_receipts.map((value) => String(value))
      : [];
    if (
      !analyzeRes.ok ||
      analyze?.status !== "trusted_memory_match" ||
      analyze?.match_source !== "exact_image_pair" ||
      analyze?.pricing_allowed !== true ||
      analyze?.learning_allowed !== true ||
      !analyze?.local_vision ||
      trustedIdentity?.player !== "Sonia Citron" ||
      String(trustedIdentity?.card_number || "") !== "122" ||
      trustedIdentity?.parallel !== "Base" ||
      checklist?.outcome !== "exact_match" ||
      String(checklist?.identity_id || "") !== SONIA_REGISTRY_ID ||
      !receipts.includes(`registry_fingerprint:${SONIA_REGISTRY_FINGERPRINT}`)
    ) {
      throw new Error(`post_correction_analyze_failed_http_${analyzeRes.status}`);
    }

    return response({
      ok: true,
      schema_version: "tcos.instacomp-ai.frozen-sonia-memory-repair.v1",
      registry_proof: {
        exact_match: true,
        candidate_count: 1,
        identity_id: SONIA_REGISTRY_ID,
        fingerprint_sha256: SONIA_REGISTRY_FINGERPRINT,
        proof_artifact_id: REGISTRY_PROOF_ARTIFACT_ID,
      },
      frozen_images: {
        raw_front_sha256: SONIA_RAW_FRONT_SHA256,
        raw_back_sha256: SONIA_RAW_BACK_SHA256,
        normalized_front_sha256: SONIA_NORMALIZED_FRONT_SHA256,
        normalized_back_sha256: SONIA_NORMALIZED_BACK_SHA256,
      },
      mac_readiness: {
        database: control.database,
        central_registry: control.central_registry,
        ollama: control.ollama || null,
        canonical_identity_authority: control.canonical_identity_authority || null,
        seller_mutations_allowed: control.seller_mutations_allowed ?? null,
      },
      correction: correctionReceipt,
      analyze: {
        http_status: analyzeRes.status,
        status: analyze.status,
        match_source: analyze.match_source,
        pricing_allowed: analyze.pricing_allowed,
        learning_allowed: analyze.learning_allowed,
        local_vision_present: Boolean(analyze.local_vision),
        trusted_identity: compactIdentity(analyze.trusted_identity),
        checklist: {
          outcome: checklist?.outcome || null,
          identity_id: checklist?.identity_id || null,
          source_receipts: receipts,
        },
      },
      local_url_exposed: false,
      local_key_exposed: false,
      mac_runtime_source_changed: false,
      registry_data_changed: false,
      inventory_changed: false,
      pricing_changed: false,
      nothing_published: true,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "acceptance_token_rejected") {
      return response({ ok: false, code: "ACCEPTANCE_TOKEN_REJECTED" }, 403);
    }
    return response(
      {
        ok: false,
        code: "FROZEN_SONIA_MEMORY_REPAIR_FAILED",
        stage,
        archive_created: archiveCreated,
        lesson_created: lessonCreated,
        error_name: error instanceof Error ? error.name.slice(0, 120) : "UnknownError",
        error: error instanceof Error ? boundedText(error.message, 1000) : "repair_failed",
        local_url_exposed: false,
        local_key_exposed: false,
        nothing_published: true,
      },
      502,
    );
  }
}
