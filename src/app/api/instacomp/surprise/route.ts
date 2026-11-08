import { NextRequest, NextResponse } from "next/server";
import {
  analyzeWithInstaCompAiLocal,
  hasConfiguredInstaCompAiLocal,
  instaCompAiLocalScanToAi,
} from "../../../../lib/instacomp-ai-local";
import {
  instaCompJobErrorResponse,
  isValidInstaCompServiceRequest,
  requireInstaCompJobActor,
} from "../../../../lib/instacomp-job-server";
import {
  checkPublicEndpointRateLimit,
  publicEndpointRateLimitResponse,
} from "../../../../lib/public-endpoint-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MEMORY_SOURCES = new Set([
  "exact_image_pair",
  "visual_memory",
  "trusted_text_memory",
]);

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

async function authorizeSurprise(request: NextRequest) {
  if (isValidInstaCompServiceRequest(request)) return null;

  const actor = await requireInstaCompJobActor(request);
  const rateLimit = await checkPublicEndpointRateLimit({
    request,
    endpointKey: "instacomp_surprise_benchmark",
    subjectKey:
      actor.type === "seller"
        ? `seller:${actor.sellerAccountId}`
        : `admin:${actor.storeId}`,
    maxAttempts: 600,
    windowSeconds: 24 * 60 * 60,
  });

  if (!rateLimit.allowed) {
    const blocked = publicEndpointRateLimitResponse(rateLimit);
    return NextResponse.json(blocked.body, { status: blocked.status });
  }

  return null;
}

function fingerprint(receipts: unknown) {
  if (!Array.isArray(receipts)) return null;
  const marker = receipts
    .map((value) => String(value || ""))
    .find((value) => value.startsWith("registry_fingerprint:"));
  return marker ? marker.slice("registry_fingerprint:".length).trim() || null : null;
}

function validateImage(file: File, label: string) {
  if (!ALLOWED_TYPES.has(String(file.type || "").toLowerCase())) {
    return `${label} must be JPEG, PNG, or WebP.`;
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    return `${label} must be larger than 0 bytes and no more than 12 MB.`;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  try {
    const blocked = await authorizeSurprise(request);
    if (blocked) return blocked;
  } catch (error) {
    return instaCompJobErrorResponse(error);
  }

  if (!hasConfiguredInstaCompAiLocal()) {
    return json(
      {
        ok: false,
        error: "SURPRISE requires the Mac InstaComp AI service to be configured.",
      },
      503,
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (error) {
    return json(
      {
        ok: false,
        error: "SURPRISE could not read the uploaded image form.",
        details: error instanceof Error ? error.message : "Invalid multipart request.",
      },
      400,
    );
  }

  const front = form.get("frontImage");
  const back = form.get("backImage");
  if (!(front instanceof File) || !(back instanceof File)) {
    return json(
      {
        ok: false,
        error: "SURPRISE requires both front and back images for every card.",
      },
      400,
    );
  }

  const frontError = validateImage(front, "Front image");
  const backError = validateImage(back, "Back image");
  if (frontError || backError) {
    return json({ ok: false, error: frontError || backError }, 400);
  }
  if (front.size + back.size > MAX_TOTAL_BYTES) {
    return json(
      {
        ok: false,
        error: "SURPRISE front + back must total 20 MB or less per card.",
      },
      400,
    );
  }

  try {
    // Intentionally call only the Mac-local InstaComp service here. SURPRISE
    // never invokes the website AI council, teacher market search, sold comps,
    // pricing, or listing pipeline. The Mac is allowed to report a trusted
    // memory hit; the response labels that separately so it cannot inflate the
    // cold-local score.
    const scan = await analyzeWithInstaCompAiLocal({
      front,
      back,
      timeoutMs: 180_000,
    });
    const ai = instaCompAiLocalScanToAi(scan);
    const receipts = scan.checklist?.source_receipts || [];
    const registryFingerprint = fingerprint(receipts);
    const registryIdentityId = String(scan.checklist?.identity_id || "").trim() || null;
    const registryOutcome = String(scan.checklist?.outcome || "").trim() || "unknown";
    const matchSource = String(scan.match_source || "none").trim() || "none";
    const localProvider = String(scan.local_suggestion?.provider || "").trim() || null;
    const localRaw =
      scan.local_suggestion?.raw && typeof scan.local_suggestion.raw === "object"
        ? scan.local_suggestion.raw
        : {};
    const candidateFallback =
      matchSource === "ollama_backup" ||
      (localRaw as Record<string, unknown>).lora_candidate_fallback === true;
    const seenByMemory =
      scan.status === "trusted_memory_match" || MEMORY_SOURCES.has(matchSource);
    const coldLora =
      !seenByMemory &&
      !candidateFallback &&
      localProvider === "instacomp_lora_candidate";
    const registryLocked =
      registryOutcome === "exact_match" &&
      Boolean(registryIdentityId) &&
      Boolean(registryFingerprint);

    const exposure = seenByMemory
      ? "seen_memory"
      : coldLora
        ? "cold_lora"
        : matchSource === "checklist_registry"
          ? "registry_resolved"
          : candidateFallback
            ? "fallback"
            : "unknown";

    return json({
      ok: true,
      mode: "SURPRISE",
      scanId: scan.scan_id,
      cardUuid: scan.card_uuid || null,
      ai,
      benchmark: {
        exposure,
        seenByMemory,
        coldLora,
        candidateFallback,
        registryLocked,
        registryOutcome,
        registryIdentityId,
        registryFingerprintSha256: registryFingerprint,
        matchSource,
        localProvider,
        scanStatus: scan.status,
        imagePairSha256: scan.image_pair_sha256 || null,
        frontSha256: scan.front_sha256 || null,
        backSha256: scan.back_sha256 || null,
        pricingCalled: false,
        teacherCalled: false,
        outsideAiCouncilCalled: false,
        learningMutation: false,
        inventoryMutation: false,
      },
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        mode: "SURPRISE",
        error: "SURPRISE Mac-local identification failed.",
        details: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      },
      500,
    );
  }
}
