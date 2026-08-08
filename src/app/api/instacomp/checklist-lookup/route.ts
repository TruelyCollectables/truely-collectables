import { NextRequest, NextResponse } from "next/server";
import { resolveInstaCompChecklistFirstFromRegistry } from "../../../../lib/instacomp-checklist-first-server";
import { requireInstaCompJobActor } from "../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../lib/instacomp-mutation-security";
import {
  checkPublicEndpointRateLimit,
  publicEndpointRateLimitResponse,
} from "../../../../lib/public-endpoint-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown, maxLength: number) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(req);
    assertTrustedInstaCompMutationRequest({ request: req, actor });

    const rateLimit = await checkPublicEndpointRateLimit({
      request: req,
      endpointKey: "instacomp_checklist_lookup",
      subjectKey:
        actor.type === "seller"
          ? `seller:${actor.sellerAccountId}`
          : `admin:${actor.storeId}`,
      maxAttempts: 2000,
      windowSeconds: 24 * 60 * 60,
    });

    if (!rateLimit.allowed) {
      const blocked = publicEndpointRateLimitResponse(rateLimit);
      return NextResponse.json(blocked.body, { status: blocked.status });
    }

    const body = await req.json().catch(() => ({}));
    const decision = await resolveInstaCompChecklistFirstFromRegistry({
      year: text(body.year, 20),
      manufacturer: text(body.manufacturer, 120),
      brand: text(body.brand, 160),
      setName: text(body.setName ?? body.set_name, 180),
      cardNumber: text(body.cardNumber, 80),
      player: text(body.player, 240),
      serialNumber: text(body.serialNumber, 80),
      isAuto: optionalBoolean(body.isAuto),
      isRelic: optionalBoolean(body.isRelic),
      parallel: text(body.parallel, 180),
      variation: text(body.variation, 180),
      // OCR remains bounded, untrusted collectible evidence. It is used only to
      // match candidate field values already present in the Checklist Registry.
      ocrText: text(body.ocrText, 12_000),
    });

    const match = decision.status === "exact_match" ? decision.match : null;
    const lockedFields = match
      ? {
          sport: match.sport || null,
          league: match.league || null,
          year: match.year || null,
          manufacturer: match.manufacturer || null,
          brand: match.brand || null,
          setName: match.setName || match.product || null,
          player: match.player || null,
          team: match.team || null,
          cardNumber: match.cardNumber || null,
          parallel: match.parallel || "Base",
          variation: match.variation || null,
          serialRun: match.serialRun || null,
          isAuto: match.isAuto,
          isRelic: match.isRelic,
        }
      : null;

    return NextResponse.json({
      ok: true,
      checklistFirst: true,
      ...decision,
      registryIdentityId: match?.identityId || null,
      identityId: match?.identityId || null,
      registryFingerprintSha256: match?.fingerprintSha256 || null,
      fingerprintSha256: match?.fingerprintSha256 || null,
      candidateCount: decision.candidates.length,
      lockedFields,
      identificationPath:
        decision.status === "exact_match"
          ? "checklist_only"
          : "ai_fallback_allowed",
    });
  } catch (error) {
    console.error("InstaComp checklist-first lookup error:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Checklist-first lookup failed.",
      },
      { status: 500 },
    );
  }
}
