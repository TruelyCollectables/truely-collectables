import { NextRequest, NextResponse } from "next/server";
import { resolveChecklistRegistry } from "../../../../lib/instacomp-learning-server";
import {
  buildInstaCompRegistryLockProbe,
  publicRegistryLockStatus,
} from "../../../../lib/instacomp-registry-lock-request";
import { requireInstaCompJobActor } from "../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../lib/instacomp-mutation-security";
import {
  checkPublicEndpointRateLimit,
  publicEndpointRateLimitResponse,
} from "../../../../lib/public-endpoint-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(req);
    assertTrustedInstaCompMutationRequest({ request: req, actor });

    const rateLimit = await checkPublicEndpointRateLimit({
      request: req,
      endpointKey: "instacomp_registry_lock",
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

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const probe = buildInstaCompRegistryLockProbe(body);
    const resolution = await resolveChecklistRegistry(probe, {
      evidenceTrusted: false,
    });
    const match = resolution.status === "internal_exact_match" ? resolution.match : null;

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
          parallel: match.parallel || null,
          variation: match.variation || null,
          serialRun: match.serialRun || null,
          isAuto: match.isAuto,
          isRelic: match.isRelic,
        }
      : null;

    return NextResponse.json({
      ok: true,
      registryLock: true,
      resolver: "resolveChecklistRegistry",
      resolverStatus: resolution.status,
      status: publicRegistryLockStatus(resolution.status),
      reasons: resolution.reasons,
      candidateCount: resolution.candidateCount,
      registryIdentityId: match?.identityId || null,
      identityId: match?.identityId || null,
      registryFingerprintSha256: match?.fingerprintSha256 || null,
      fingerprintSha256: match?.fingerprintSha256 || null,
      lockedFields,
      identificationPath: match ? "authoritative_registry_exact_lock" : "review_required",
    });
  } catch (error) {
    console.error("InstaComp Registry exact-lock error:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Checklist Registry exact lock failed.",
      },
      { status: 500 },
    );
  }
}
