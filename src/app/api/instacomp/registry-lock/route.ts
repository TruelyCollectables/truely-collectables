import { NextRequest, NextResponse } from "next/server";
import { resolveChecklistRegistry } from "../../../../lib/instacomp-learning-server";
import {
  buildInstaCompRegistryLockProbe,
  publicRegistryLockStatus,
} from "../../../../lib/instacomp-registry-lock-request";
import { requireInstaCompJobActor } from "../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../lib/instacomp-mutation-security";
import { isValidInstaCompSentinelArchiveRequest } from "../../../../lib/instacomp-sentinel-auth";
import { getActiveStoreId } from "../../../../lib/stores";
import {
  checkPublicEndpointRateLimit,
  publicEndpointRateLimitResponse,
} from "../../../../lib/public-endpoint-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // Existing Mac installs already share the dedicated Sentinel archive token
    // with Production. Registry lock is read-only identity resolution, so allow
    // that same narrowly scoped Mac credential here instead of requiring a
    // second manually synchronized service secret. All other job/mutation routes
    // retain their existing service/seller/admin authentication contracts.
    const sentinelMacRequest = isValidInstaCompSentinelArchiveRequest(req);
    const actor = sentinelMacRequest
      ? {
          type: "admin" as const,
          storeId: getActiveStoreId(),
          sellerAccountId: null,
        }
      : await requireInstaCompJobActor(req);

    if (!sentinelMacRequest) {
      assertTrustedInstaCompMutationRequest({ request: req, actor });
    }

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
    let resolution = await resolveChecklistRegistry(probe, {
      evidenceTrusted: false,
    });

    // OCR/VLM readers occasionally drop one leading digit from a printed card
    // number (for example 122 -> 22). If the ordinary exact lookup fails, try
    // exactly one additional leading digit 1..9 through the SAME authoritative
    // resolver. Run the bounded candidates concurrently because each resolver
    // lookup is independent and Registry growth must not multiply route latency
    // nine-fold. Still accept recovery only when exactly one distinct Registry
    // identity resolves across all player/release/set/parallel evidence.
    const observedCardNumber = String(probe.cardNumber || "").trim();
    if (
      resolution.status !== "internal_exact_match" &&
      /^\d{1,3}$/.test(observedCardNumber)
    ) {
      const attempts = await Promise.all(
        Array.from({ length: 9 }, (_, index) =>
          resolveChecklistRegistry(
            { ...probe, cardNumber: `${index + 1}${observedCardNumber}` },
            { evidenceTrusted: false },
          ),
        ),
      );
      const recovered = new Map<string, typeof resolution>();
      for (const attempt of attempts) {
        if (attempt.status === "internal_exact_match" && attempt.match) {
          recovered.set(attempt.match.identityId, attempt);
        }
      }
      if (recovered.size === 1) {
        const [only] = recovered.values();
        resolution = {
          ...only,
          reasons: [
            ...only.reasons,
            `unique_leading_digit_card_number_recovery:${observedCardNumber}->${only.match?.cardNumber || ""}`,
          ],
        };
      }
    }

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
