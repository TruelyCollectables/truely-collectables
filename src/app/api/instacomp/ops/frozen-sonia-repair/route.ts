import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CANONICAL_MAC_URL = "https://instacomp.truelycollectables.com";
const EXPECTED_FRONT_SHA256 = "eaacec37493b419f1d397df739aedd9df218639ded876c481b2fb28b2b3eb2b1";
const EXPECTED_BACK_SHA256 = "3ecd070456e09342ed83ca88193ed2d029cd8a77ed5b2e2ae1ce443e9866978c";
const EXPECTED_NORMALIZED_FRONT_SHA256 = "9dac4f6e94ff5d2180c0dda73008ec46f214dfde2cd59314493186ce1b5dc46d";
const EXPECTED_NORMALIZED_BACK_SHA256 = "5feb7d055f8ba36c6b8f6e8ad9622d1587d1267614d9ce9c2bfb841f04ff20e8";
const EXPECTED_REGISTRY_ID = "2a7d4ddd-e9f7-4ce2-904c-b1a17b33ae4f";
const EXPECTED_REGISTRY_FINGERPRINT = "4366f96b6cf8b136e5ae4da70c35539d56e1793de0a42bcccbf970a892791e59";

type MacStage = "training_readback" | "supervised_archive" | "create_lesson" | "analyze";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function sameSecret(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function requireAcceptanceToken(request: Request) {
  const expected = String(process.env.INSTACOMP_ACCEPTANCE_SERVICE_TOKEN || "").trim();
  const provided = String(request.headers.get("x-tcos-instacomp-service-token") || "").trim();
  if (!expected || !sameSecret(expected, provided)) {
    throw new Error("ACCEPTANCE_AUTH_REJECTED");
  }
}

function macConfig() {
  const url = String(process.env.INSTACOMP_AI_LOCAL_URL || "").trim().replace(/\/+$/, "");
  const key = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
  if (url !== CANONICAL_MAC_URL || !key) throw new Error("MAC_CONNECTION_NOT_CONFIGURED");
  return { url, key };
}

async function macJson(stage: MacStage, path: string, init: RequestInit, timeoutMs: number) {
  const { url, key } = macConfig();
  const headers = new Headers(init.headers);
  headers.set("X-InstaComp-AI-Key", key);
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await response.text();
  let payload: any = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { parseError: true };
  }
  if (!response.ok) {
    const detail = String(payload?.detail || payload?.error || "request failed").slice(0, 180);
    throw new Error(`STAGE_${stage.toUpperCase()}_MAC_HTTP_${response.status}:${detail}`);
  }
  return payload;
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactBaseExample(example: any) {
  const identity = example?.confirmed_identity;
  return (
    String(example?.front_sha256 || "") === EXPECTED_NORMALIZED_FRONT_SHA256 &&
    String(example?.back_sha256 || "") === EXPECTED_NORMALIZED_BACK_SHA256 &&
    example?.trusted === true &&
    identity?.player === "Sonia Citron" &&
    String(identity?.card_number || "") === "122" &&
    identity?.parallel === "Base"
  );
}

export async function POST(request: Request) {
  try {
    requireAcceptanceToken(request);
    const form = await request.formData();
    const frontValue = form.get("front");
    const backValue = form.get("back");
    if (!(frontValue instanceof File) || !(backValue instanceof File)) {
      return json({ ok: false, code: "FROZEN_IMAGES_REQUIRED" }, 400);
    }

    const frontBytes = Buffer.from(await frontValue.arrayBuffer());
    const backBytes = Buffer.from(await backValue.arrayBuffer());
    const frontHash = sha256(frontBytes);
    const backHash = sha256(backBytes);
    if (frontHash !== EXPECTED_FRONT_SHA256 || backHash !== EXPECTED_BACK_SHA256) {
      return json({ ok: false, code: "FROZEN_IMAGE_HASH_MISMATCH" }, 409);
    }

    const readbackBefore = await macJson(
      "training_readback",
      "/v1/training/examples?trusted_only=true&limit=5000",
      { method: "GET" },
      45_000,
    );
    const beforeExamples = Array.isArray(readbackBefore?.examples) ? readbackBefore.examples : [];
    let existingBase = beforeExamples.find(exactBaseExample) as any | undefined;
    let correctionCreated = false;
    let archive: any = null;
    let lesson: any = existingBase
      ? {
          lesson_id: existingBase.lesson_id,
          training_example_id: existingBase.training_example_id,
          trusted: existingBase.trusted,
          state: existingBase.state,
          scan_id: existingBase.scan_id,
          identity: existingBase.confirmed_identity,
        }
      : null;

    if (!existingBase) {
      const archiveForm = new FormData();
      archiveForm.append("front", new File([frontBytes], "front.jpg", { type: "image/jpeg" }));
      archiveForm.append("back", new File([backBytes], "back.jpg", { type: "image/jpeg" }));
      archive = await macJson(
        "supervised_archive",
        "/v1/scans/supervised-archive",
        { method: "POST", body: archiveForm },
        90_000,
      );
      if (
        archive.identity_created !== false ||
        archive.nothing_published !== true ||
        String(archive.front_sha256 || "") !== EXPECTED_NORMALIZED_FRONT_SHA256 ||
        String(archive.back_sha256 || "") !== EXPECTED_NORMALIZED_BACK_SHA256 ||
        !String(archive.scan_id || "").trim()
      ) {
        throw new Error("SUPERVISED_ARCHIVE_BOUNDARY_REJECTED");
      }

      const lessonRequest = {
        scan_id: archive.scan_id,
        state: "operator_confirmed",
        identity: {
          sport: "Basketball",
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
        verification_source: `frozen_acceptance_v8_registry:${EXPECTED_REGISTRY_ID}`,
        operator_id: "tcos_frozen_truth_repair_20260810",
        notes: `Corrected exact frozen-image trusted memory after Production Registry locked canonical Base UUID ${EXPECTED_REGISTRY_ID} fingerprint ${EXPECTED_REGISTRY_FINGERPRINT}. No inventory, pricing, or publishing mutation.`,
        rejected_identity: {
          year: "2025",
          manufacturer: "Panini",
          brand: "Panini Prizm WNBA",
          set_name: "Base",
          player: "Sonia Citron",
          card_number: "122",
          parallel: "Orange Cracked Ice Prizm",
        },
      };
      lesson = await macJson(
        "create_lesson",
        "/v1/lessons",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(lessonRequest),
        },
        45_000,
      );
      correctionCreated = true;
      if (
        lesson.trusted !== true ||
        lesson.state !== "operator_confirmed" ||
        lesson.scan_id !== archive.scan_id ||
        lesson.identity?.player !== "Sonia Citron" ||
        lesson.identity?.card_number !== "122" ||
        lesson.identity?.parallel !== "Base"
      ) {
        throw new Error("CORRECTED_LESSON_REJECTED");
      }

      const readbackAfter = await macJson(
        "training_readback",
        "/v1/training/examples?trusted_only=true&limit=5000",
        { method: "GET" },
        45_000,
      );
      const afterExamples = Array.isArray(readbackAfter?.examples) ? readbackAfter.examples : [];
      existingBase = afterExamples.find(exactBaseExample);
      if (!existingBase) throw new Error("CORRECTED_BASE_TRAINING_READBACK_MISSING");
    }

    const analyzeForm = new FormData();
    analyzeForm.append("front", new File([frontBytes], "front.jpg", { type: "image/jpeg" }));
    analyzeForm.append("back", new File([backBytes], "back.jpg", { type: "image/jpeg" }));
    const analyze = await macJson(
      "analyze",
      "/v1/scans/analyze",
      { method: "POST", body: analyzeForm },
      210_000,
    );
    if (
      analyze.status !== "trusted_memory_match" ||
      analyze.match_source !== "exact_image_pair" ||
      analyze.pricing_allowed !== true ||
      analyze.learning_allowed !== true ||
      analyze.trusted_identity?.player !== "Sonia Citron" ||
      analyze.trusted_identity?.card_number !== "122" ||
      analyze.trusted_identity?.parallel !== "Base" ||
      analyze.checklist?.outcome !== "exact_match" ||
      String(analyze.checklist?.identity_id || "") !== EXPECTED_REGISTRY_ID
    ) {
      throw new Error("CORRECTED_MAC_ANALYZE_DID_NOT_EXACT_LOCK");
    }

    return json({
      ok: true,
      schema: "tcos.instacomp.frozenSoniaRepair.v2",
      rawImageHashes: { front: frontHash, back: backHash },
      normalizedImageHashes: {
        front: existingBase?.front_sha256 || archive?.front_sha256 || null,
        back: existingBase?.back_sha256 || archive?.back_sha256 || null,
      },
      registry: {
        identityId: EXPECTED_REGISTRY_ID,
        fingerprintSha256: EXPECTED_REGISTRY_FINGERPRINT,
      },
      correction: {
        createdThisRun: correctionCreated,
        exactBaseExamplePresentBeforeRun: !correctionCreated,
      },
      lesson: {
        lessonId: lesson?.lesson_id || existingBase?.lesson_id || null,
        trainingExampleId: lesson?.training_example_id || existingBase?.training_example_id || null,
        trusted: lesson?.trusted ?? existingBase?.trusted ?? null,
        state: lesson?.state || existingBase?.state || null,
      },
      analyze: {
        status: analyze.status,
        matchSource: analyze.match_source,
        pricingAllowed: analyze.pricing_allowed,
        learningAllowed: analyze.learning_allowed,
        checklistOutcome: analyze.checklist?.outcome,
        registryIdentityId: analyze.checklist?.identity_id,
        identity: analyze.trusted_identity,
      },
      nothingPublished: true,
      inventoryMutation: false,
      pricingMutation: false,
      modelWeightsMutation: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const auth = message === "ACCEPTANCE_AUTH_REJECTED";
    const stageMatch = message.match(/^STAGE_([A-Z_]+)_MAC_HTTP_/);
    return json(
      {
        ok: false,
        code: auth ? "ACCEPTANCE_AUTH_REJECTED" : "FROZEN_SONIA_REPAIR_FAILED",
        failedStage: stageMatch ? stageMatch[1].toLowerCase() : null,
        error: auth ? "Acceptance authentication rejected." : message.slice(0, 260),
      },
      auth ? 401 : 500,
    );
  }
}
