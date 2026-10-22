import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { analyzeWithInstaCompAiLocal } from "../../../../lib/instacomp-ai-local";

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
  const supplied = String(
    request.headers.get("x-tcos-instacomp-service-token") || "",
  ).trim();
  if (!expected || !exactSecretMatch(expected, supplied)) {
    throw new Error("acceptance_token_rejected");
  }
}

function safeIdentity(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const allowed = [
    "sport",
    "league",
    "year",
    "manufacturer",
    "brand",
    "set_name",
    "subset",
    "player",
    "team",
    "card_number",
    "parallel",
    "variation",
    "serial_number",
    "serial_run",
    "rookie",
    "autograph",
    "inscription",
    "memorabilia",
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  );
}

function safeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
        .slice(0, 50)
        .map((entry) => entry.slice(0, 500))
    : [];
}

export async function POST(request: Request) {
  try {
    requireAcceptanceToken(request);
    const form = await request.formData();
    const front = form.get("front");
    const back = form.get("back");
    if (!(front instanceof File) || !(back instanceof File)) {
      return response({ ok: false, code: "DIAGNOSTIC_IMAGES_REQUIRED" }, 400);
    }
    for (const [label, file] of [
      ["front", front],
      ["back", back],
    ] as const) {
      if (!ALLOWED_IMAGE_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
        return response(
          { ok: false, code: "DIAGNOSTIC_IMAGE_REJECTED", side: label },
          400,
        );
      }
    }

    const scan = await analyzeWithInstaCompAiLocal({
      front,
      back,
      timeoutMs: 240_000,
    });
    const localVision =
      scan.local_vision && typeof scan.local_vision === "object"
        ? (scan.local_vision as Record<string, unknown>)
        : {};
    const hints = safeIdentity(localVision.identity_hints);
    return response({
      ok: true,
      schema_version: "tcos.instacomp-ai.acceptance-runtime-diagnostic.v1",
      status: scan.status,
      scan_id: scan.scan_id,
      card_uuid: scan.card_uuid || null,
      front_sha256: scan.front_sha256 || null,
      back_sha256: scan.back_sha256 || null,
      image_pair_sha256: scan.image_pair_sha256 || null,
      pricing_allowed: scan.pricing_allowed === true,
      learning_allowed: scan.learning_allowed === true,
      match_source: scan.match_source || null,
      visual_match_score: scan.visual_match_score ?? null,
      canonical_filename: scan.canonical_filename || null,
      trusted_identity: safeIdentity(scan.trusted_identity),
      local_suggestion: scan.local_suggestion
        ? {
            provider: String(scan.local_suggestion.provider || ""),
            model: String(scan.local_suggestion.model || ""),
            confidence: Number(scan.local_suggestion.confidence || 0),
            identity: safeIdentity(scan.local_suggestion.identity),
          }
        : null,
      deterministic_identity_hints: hints,
      checklist: {
        outcome: String(scan.checklist?.outcome || ""),
        identity_id: scan.checklist?.identity_id || null,
        candidate_count: Number(
          (scan.checklist as Record<string, unknown> | undefined)?.candidate_count || 0,
        ),
        reasons: safeStringArray(scan.checklist?.reasons),
        source_receipts: safeStringArray(scan.checklist?.source_receipts),
      },
      next_action: String(scan.next_action || "").slice(0, 1000),
      nothing_published: true,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "acceptance_token_rejected") {
      return response({ ok: false, code: "ACCEPTANCE_TOKEN_REJECTED" }, 403);
    }
    const name = error instanceof Error ? error.name : "UnknownError";
    const message = error instanceof Error ? error.message : "diagnostic_failed";
    return response(
      {
        ok: false,
        code: "ACCEPTANCE_RUNTIME_DIAGNOSTIC_FAILED",
        error_name: name.slice(0, 120),
        error: message.slice(0, 1000),
      },
      502,
    );
  }
}
