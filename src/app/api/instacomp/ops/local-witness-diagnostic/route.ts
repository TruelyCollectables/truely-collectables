import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CANONICAL_MAC_URL = "https://instacomp.truelycollectables.com";
const EXPECTED_FRONT_SHA256 = "eaacec37493b419f1d397df739aedd9df218639ded876c481b2fb28b2b3eb2b1";
const EXPECTED_BACK_SHA256 = "3ecd070456e09342ed83ca88193ed2d029cd8a77ed5b2e2ae1ce443e9866978c";

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
  if (!expected || !sameSecret(expected, provided)) throw new Error("ACCEPTANCE_AUTH_REJECTED");
}

function macConfig() {
  const url = String(process.env.INSTACOMP_AI_LOCAL_URL || "").trim().replace(/\/+$/, "");
  const key = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
  if (url !== CANONICAL_MAC_URL || !key) throw new Error("MAC_CONNECTION_NOT_CONFIGURED");
  return { url, key };
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function boundedOcr(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map((entry) => {
    const item = record(entry);
    return {
      text: typeof item.text === "string" ? item.text.slice(0, 240) : null,
      confidence: typeof item.confidence === "number" ? item.confidence : null,
    };
  });
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
    if (sha256(frontBytes) !== EXPECTED_FRONT_SHA256 || sha256(backBytes) !== EXPECTED_BACK_SHA256) {
      return json({ ok: false, code: "FROZEN_IMAGE_HASH_MISMATCH" }, 409);
    }

    const { url, key } = macConfig();
    const analyzeForm = new FormData();
    analyzeForm.append("front", new File([frontBytes], "front.jpg", { type: "image/jpeg" }));
    analyzeForm.append("back", new File([backBytes], "back.jpg", { type: "image/jpeg" }));
    const response = await fetch(`${url}/v1/scans/analyze`, {
      method: "POST",
      headers: { "X-InstaComp-AI-Key": key },
      body: analyzeForm,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(210_000),
    });
    const raw = await response.text();
    let scan: Record<string, any> = {};
    try {
      scan = raw ? JSON.parse(raw) : {};
    } catch {
      scan = { parse_error: true };
    }
    if (!response.ok) {
      return json({
        ok: false,
        code: "MAC_ANALYZE_FAILED",
        httpStatus: response.status,
        detail: String(scan.detail || scan.error || "request failed").slice(0, 220),
      }, 502);
    }

    const localVision = record(scan.local_vision);
    const front = record(localVision.front);
    const back = record(localVision.back);
    const hints = record(localVision.identity_hints);
    const pattern = record(front.pattern);

    return json({
      ok: true,
      schema: "tcos.instacomp.localWitnessDiagnostic.v1",
      scan: {
        status: scan.status || null,
        matchSource: scan.match_source || null,
        pricingAllowed: scan.pricing_allowed === true,
        learningAllowed: scan.learning_allowed === true,
        trustedIdentityPresent: Boolean(scan.trusted_identity),
        localSuggestion: scan.local_suggestion
          ? {
              provider: scan.local_suggestion.provider || null,
              model: scan.local_suggestion.model || null,
              confidence: scan.local_suggestion.confidence ?? null,
            }
          : null,
        checklist: {
          outcome: scan.checklist?.outcome || null,
          identityId: scan.checklist?.identity_id || null,
          reasons: Array.isArray(scan.checklist?.reasons) ? scan.checklist.reasons.slice(0, 20) : [],
        },
      },
      localVision: {
        appleVisionAvailable: localVision.apple_vision_available ?? null,
        opencvAvailable: localVision.opencv_available ?? null,
        combinedText: String(localVision.combined_text || "").slice(0, 1200),
        identityHints: hints,
        front: {
          width: front.width ?? null,
          height: front.height ?? null,
          errors: Array.isArray(front.errors) ? front.errors.slice(0, 20) : [],
          ocr: boundedOcr(front.ocr),
          patternLabel: typeof pattern.label === "string" ? pattern.label.slice(0, 160) : null,
        },
        back: {
          width: back.width ?? null,
          height: back.height ?? null,
          errors: Array.isArray(back.errors) ? back.errors.slice(0, 20) : [],
          ocr: boundedOcr(back.ocr),
        },
      },
      mutations: {
        registry: false,
        inventory: false,
        pricing: false,
        publishing: false,
        learning: false,
        modelWeights: false,
        backup: false,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const auth = message === "ACCEPTANCE_AUTH_REJECTED";
    return json({
      ok: false,
      code: auth ? "ACCEPTANCE_AUTH_REJECTED" : "LOCAL_WITNESS_DIAGNOSTIC_FAILED",
      error: auth ? "Acceptance authentication rejected." : message.slice(0, 220),
    }, auth ? 401 : 500);
  }
}
