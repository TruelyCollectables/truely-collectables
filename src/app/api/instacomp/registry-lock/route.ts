import { NextRequest, NextResponse } from "next/server";
import {
  revalidateChecklistRegistryReceipt,
  resolveChecklistRegistry,
} from "../../../../lib/instacomp-learning-server";
import { shouldApplyInstaCompRegistryLockPublicRateLimit } from "../../../../lib/instacomp-checklist-rate-limit-policy";
import {
  buildInstaCompRegistryLockProbe,
  publicRegistryLockStatus,
} from "../../../../lib/instacomp-registry-lock-request";
import { resolveRegistryDirectExact } from "../../../../lib/instacomp-registry-direct-exact";
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

function text(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

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

    const security = sentinelMacRequest
      ? null
      : assertTrustedInstaCompMutationRequest({ request: req, actor });

    // Both internal Mac credentials are authenticated before this point. They
    // are intentionally unthrottled so promotion, certification, and torture
    // tests can drive Registry at full speed without consuming a public abuse
    // bucket. Seller and browser-admin callers retain the existing limiter.
    if (
      shouldApplyInstaCompRegistryLockPublicRateLimit({
        channel: security?.channel ?? null,
        sentinelMacRequest,
      })
    ) {
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
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const probe = buildInstaCompRegistryLockProbe(body);
    const receiptIdentityId = text(
      body.registryIdentityId || body.identityId || body.expectedRegistryIdentityId,
    );
    const receiptFingerprint = text(
      body.registryFingerprintSha256 ||
        body.fingerprintSha256 ||
        body.expectedRegistryFingerprintSha256,
    )?.toLowerCase();

    let receiptRevalidationAttempted = false;
    let receiptRevalidationAccepted = false;
    let directExactRecoveryAccepted = false;
    let resolution = null as Awaited<ReturnType<typeof resolveChecklistRegistry>> | null;

    // Locked validation/training rows can already carry a prior Registry UUID +
    // fingerprint. Do not make the broad resolver rediscover that identity from
    // scratch. Revalidate the exact receipt against the CURRENT live Registry
    // row plus the current visible evidence. This remains fail-closed: stale,
    // missing, inactive, fingerprint-drifted, or evidence-incompatible receipts
    // return null and cannot become an authoritative lock.
    if (receiptIdentityId && receiptFingerprint) {
      receiptRevalidationAttempted = true;
      const revalidated = await revalidateChecklistRegistryReceipt({
        ai: probe,
        identityId: receiptIdentityId,
        fingerprintSha256: receiptFingerprint,
      });
      if (revalidated?.status === "internal_exact_match" && revalidated.match) {
        resolution = revalidated;
        receiptRevalidationAccepted = true;
      }
    }

    if (!resolution) {
      resolution = await resolveChecklistRegistry(probe, {
        evidenceTrusted: false,
      });
    }

    // The broad resolver intentionally begins at bounded release/set coverage,
    // but a year with thousands of checklist sets can still exhaust that scope
    // before a clean exact card is examined. A second fail-closed path starts at
    // the indexed exact card number (or an internally verified physical-number
    // alias), then proves year + player + product/set + variant facts and accepts
    // only one unique Registry fingerprint. It never uses listing-title claims.
    if (resolution.status !== "internal_exact_match") {
      const direct = await resolveRegistryDirectExact(probe);
      if (direct?.status === "internal_exact_match" && direct.match) {
        resolution = direct;
        directExactRecoveryAccepted = true;
      }
    }

    // OCR/VLM readers occasionally drop one leading digit from a printed card
    // number (for example 122 -> 22). If the ordinary exact lookup fails, try
    // exactly one additional leading digit 1..9 through the SAME authoritative
    // resolver. Accept recovery only when exactly one distinct Registry identity
    // resolves across all player/release/set/parallel evidence. This is bounded,
    // deterministic, and fails closed on ambiguity.
    const observedCardNumber = String(probe.cardNumber || "").trim();
    if (
      resolution.status !== "internal_exact_match" &&
      /^\d{1,3}$/.test(observedCardNumber)
    ) {
      const recovered = new Map<string, typeof resolution>();
      for (let prefix = 1; prefix <= 9; prefix += 1) {
        const candidateNumber = `${prefix}${observedCardNumber}`;
        const attempt = await resolveChecklistRegistry(
          { ...probe, cardNumber: candidateNumber },
          { evidenceTrusted: false },
        );
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
      receiptRevalidationAttempted,
      receiptRevalidationAccepted,
      directExactRecoveryAccepted,
      lockedFields,
      identificationPath: match
        ? receiptRevalidationAccepted
          ? "authoritative_registry_receipt_revalidated"
          : directExactRecoveryAccepted
            ? "authoritative_registry_bounded_direct_exact"
            : "authoritative_registry_exact_lock"
        : "review_required",
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
