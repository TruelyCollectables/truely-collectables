import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" },
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
  if (!url || !key) throw new Error("MAC_CONNECTION_NOT_CONFIGURED");
  return { url, key };
}

function rec(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function txt(value: unknown, max = 240) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : null;
}

function ocrSummary(sideValue: unknown) {
  const side = rec(sideValue);
  const rows = Array.isArray(side.ocr) ? side.ocr : [];
  return {
    count: rows.length,
    text: rows.slice(0, 40).map((row: unknown) => txt(rec(row).text, 140)).filter(Boolean),
    errors: Array.isArray(side.errors) ? side.errors.slice(0, 12).map((v: unknown) => txt(v, 180)).filter(Boolean) : [],
    patternLabel: rec(side.pattern).label || null,
    patternConfidence: rec(side.pattern).confidence ?? null,
  };
}

export async function POST(request: Request) {
  try {
    requireAcceptanceToken(request);
    const form = await request.formData();
    const front = form.get("front");
    const back = form.get("back");
    if (!(front instanceof File) || !(back instanceof File)) return json({ ok: false, code: "IMAGES_REQUIRED" }, 400);

    const { url, key } = macConfig();
    const identityResponse = await fetch(`${url}/v1/runtime-identity`, {
      method: "GET",
      headers: { "X-InstaComp-AI-Key": key },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    const identityRaw = await identityResponse.text();
    let runtimeIdentity: Record<string, any> = {};
    try { runtimeIdentity = identityRaw ? JSON.parse(identityRaw) : {}; } catch { runtimeIdentity = { parse_error: true }; }
    if (!identityResponse.ok) return json({ ok: false, code: "MAC_RUNTIME_IDENTITY_FAILED", httpStatus: identityResponse.status }, 502);

    const body = new FormData();
    body.append("front", front, "front.jpg");
    body.append("back", back, "back.jpg");
    const response = await fetch(`${url}/v1/scans/analyze`, {
      method: "POST",
      headers: { "X-InstaComp-AI-Key": key },
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(260_000),
    });
    const raw = await response.text();
    let scan: Record<string, any> = {};
    try { scan = raw ? JSON.parse(raw) : {}; } catch { scan = { parse_error: true }; }
    if (!response.ok) return json({ ok: false, code: "MAC_ANALYZE_FAILED", httpStatus: response.status, detail: txt(scan.detail || scan.error) }, 502);

    const suggestion = rec(scan.local_suggestion);
    const identity = rec(suggestion.identity);
    const suggestionRaw = rec(suggestion.raw);
    const checklist = rec(scan.checklist);
    const localVision = rec(scan.local_vision);
    const hints = rec(localVision.identity_hints);
    return json({
      ok: true,
      schema: "tcos.instacomp.localVisionPostfixProof.v1",
      runtimeSourceFingerprint: runtimeIdentity.runtime_source_fingerprint || null,
      runtimeVersion: runtimeIdentity.version || null,
      status: scan.status || null,
      matchSource: scan.match_source || null,
      localSuggestion: {
        provider: suggestion.provider || null,
        model: suggestion.model || null,
        confidence: suggestion.confidence ?? null,
        identity: {
          player: identity.player || null,
          year: identity.year || null,
          manufacturer: identity.manufacturer || identity.brand || null,
          setName: identity.set_name || identity.setName || null,
          cardNumber: identity.card_number || identity.cardNumber || null,
          parallel: identity.parallel || null,
        },
        loraCandidateFallback: suggestionRaw.lora_candidate_fallback === true,
        loraCandidateErrorType: txt(suggestionRaw.lora_candidate_error_type, 80),
        loraCandidateError: txt(suggestionRaw.lora_candidate_error, 320),
      },
      localVision: {
        appleVisionAvailable: localVision.apple_vision_available ?? null,
        opencvAvailable: localVision.opencv_available ?? null,
        identityHints: {
          year: hints.year || null,
          manufacturer: hints.manufacturer || hints.brand || null,
          cardNumber: hints.card_number || hints.cardNumber || null,
          parallel: hints.parallel || null,
        },
        combinedText: txt(localVision.combined_text, 1600),
        front: ocrSummary(localVision.front),
        back: ocrSummary(localVision.back),
      },
      checklist: {
        outcome: checklist.outcome || null,
        identityId: checklist.identity_id || null,
        candidateCount: checklist.candidate_count ?? null,
        reasons: Array.isArray(checklist.reasons) ? checklist.reasons.slice(0, 12).map((v: unknown) => txt(v, 220)) : [],
      },
      mutations: { registry: false, pricing: false, publishing: false, learning: false, modelWeights: false, backup: false },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const auth = message === "ACCEPTANCE_AUTH_REJECTED";
    return json({ ok: false, code: auth ? "ACCEPTANCE_AUTH_REJECTED" : "DIAGNOSTIC_FAILED", error: txt(message) }, auth ? 401 : 500);
  }
}
