import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/kingmaker-local-auth";
import { postInstaCompMacRegistry } from "../../../../../../lib/instacomp-mac-registry-client";
import { listMacMasterListingRows } from "../../../../../../lib/kingmaker-mac-scan-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_WORKBENCH_CARDS = 100;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown, maximum = 2_000) {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maximum) : null;
}

function numberOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringList(value: unknown, limit = 30) {
  return Array.isArray(value)
    ? value
        .map((entry) => text(entry, 240))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, limit)
    : [];
}
function imagePair(metadata: JsonRecord) {
  const instaComp = record(metadata.instacomp);
  const recovered = record(instaComp.recoveredImageUrls);
  const sourceImages = Array.isArray(instaComp.sourceImageUrls) ? instaComp.sourceImageUrls : [];
  const front =
    text(instaComp.frontImageUrl, 2_000) ||
    text(recovered.front, 2_000) ||
    text(sourceImages[0], 2_000);
  const back =
    text(instaComp.backImageUrl, 2_000) ||
    text(recovered.back, 2_000) ||
    text(sourceImages[1], 2_000);
  const scanId = text(instaComp.scanId, 100);
  return {
    frontImageUrl: front || (scanId ? `/api/kingmaker/scan-image?scanId=${encodeURIComponent(scanId)}&side=front` : null),
    backImageUrl: back || (scanId ? `/api/kingmaker/scan-image?scanId=${encodeURIComponent(scanId)}&side=back` : null),
    frontFound: Boolean(front || scanId),
    backFound: Boolean(back || scanId),
    distinctUrls: Boolean((front && back && front !== back) || scanId),
    storedImageCount: front && back ? 2 : scanId ? 2 : Number(Boolean(front)) + Number(Boolean(back)),
    readyForAutomaticScan: Boolean((front && back && front !== back) || scanId),
  };
}

async function registryCoverage() {
  try {
    const data = await postInstaCompMacRegistry("/api/instacomp/registry-stats", {}, 10_000);
    return {
      available: true,
      authenticated: true,
      authority: "mac_local_registry",
      activeLiveVersions: Number(data.activeReleases || 0),
      activeLiveCards: Number(data.activeIdentities || 0),
      lookupScope: "Mac-local authoritative Registry identities",
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      authenticated: false,
      authority: "mac_local_registry",
      activeLiveVersions: 0,
      activeLiveCards: 0,
      lookupScope: "Mac-local authoritative Registry identities",
      error: error instanceof Error ? error.message : "Mac Registry coverage could not be read.",
    };
  }
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }
    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const isOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    const [masterRows, coverage] = await Promise.all([
      listMacMasterListingRows({ folder: "pending", compact: false, timeoutMs: 15_000 }),
      registryCoverage(),
    ]);
    const rows = masterRows
      .filter((row: any) => {
        const sellerAccountId = text(row.seller_account_id ?? row.sellerAccountId, 200);
        return isOwner || !sellerAccountId || sellerAccountId === account.id;
      })
      .sort((left: any, right: any) =>
        String(right.updated_at || right.updatedAt || "").localeCompare(
          String(left.updated_at || left.updatedAt || ""),
        ),
      )
      .slice(0, MAX_WORKBENCH_CARDS);

    const items = rows.map((row: any) => {
      const metadata = record(row.metadata);
      const instaComp = record(metadata.instacomp);
      const ai = record(instaComp.ai);
      const orientation = record(instaComp.imageOrientation);
      const checklistDecision = record(instaComp.checklistDecision);
      const parallelDecision = record(instaComp.parallelDecision);
      const identityComplete = instaComp.identityComplete === true;
      const manuallyLocked = instaComp.manualIdentityLocked === true;
      const trustedParallel = text(
        ai.checklistParallel || ai.parallelName || ai.parallel,
        160,
      );
      const parallel =
        identityComplete || manuallyLocked
          ? trustedParallel || "Base"
          : null;

      return {
        inventoryItemId: String(row.id),
        title: text(row.title, 240) || "Untitled card",
        sku: text(row.sku, 120),
        updatedAt: row.updated_at || row.updatedAt || null,
        imageAudit: imagePair(metadata),
        identity: {
          identityComplete,
          locked: manuallyLocked,
          humanVerified: instaComp.humanVerified === true,
          trustedForIdentity: instaComp.trustedForIdentity === true,
          savedAt: text(instaComp.manualIdentitySavedAt, 80),
          source: text(instaComp.identitySource, 160),
          player: text(ai.player || ai.playerName, 180),
          year: text(ai.year, 20),
          manufacturer: text(ai.manufacturer || ai.brand, 120),
          setName: text(ai.setName || ai.set, 200),
          cardNumber: text(ai.cardNumber || ai.card_number, 80),
          parallel,
          variation: text(ai.variation, 160),
          serialNumber: text(ai.serialNumber || ai.printRun, 120),
          sport: text(ai.sport, 120),
          team: text(ai.team, 180),
          isAuto: ai.isAuto === true,
          isRelic: ai.isRelic === true,
        },
        orientation: {
          persisted: instaComp.imageOrientationPersisted === true,
          status: text(orientation.status, 80),
          model: text(orientation.model, 120),
          frontRotation: numberOrZero(orientation.frontRotation),
          backRotation: numberOrZero(orientation.backRotation),
          frontConfidence: numberOrZero(orientation.frontConfidence),
          backConfidence: numberOrZero(orientation.backConfidence),
          frontEvidenceText: stringList(orientation.frontEvidenceText, 12),
          backEvidenceText: stringList(orientation.backEvidenceText, 12),
          reason: text(orientation.reason, 1_000),
        },
        checklist: {
          status:
            text(checklistDecision.status, 80) ||
            text(record(instaComp.checklistIdentity).status, 80),
          candidateCount: numberOrZero(
            checklistDecision.candidateCount ||
              record(instaComp.checklistIdentity).candidateCount,
          ),
          reasons: stringList(checklistDecision.reasons, 30),
          candidateIdentityIds: stringList(
            checklistDecision.candidateIdentityIds,
            100,
          ),
          parallelStatus: text(parallelDecision.status, 80),
          selectedParallel: text(parallelDecision.selectedParallel, 160),
          parallelConfidence: numberOrZero(parallelDecision.confidence),
          parallelEvidence: text(parallelDecision.evidence, 1_000),
          candidateParallels: stringList(
            parallelDecision.candidateParallels,
            100,
          ),
        },
        scan: {
          scanId: text(instaComp.scanId, 100),
          lastStatus: text(instaComp.lastStatus, 80),
          lastStage: text(instaComp.lastStage, 80),
          lastError: text(instaComp.lastError, 1_000),
          lastErrorCode: text(instaComp.lastErrorCode, 120),
          pricingStatus: text(instaComp.pricingStatus, 120),
          pricingReason: text(instaComp.pricingReason, 1_000),
          learningPromotion: record(instaComp.learningPromotion),
        },
      };
    });

    return NextResponse.json(
      {
        success: true,
        generatedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        limit: MAX_WORKBENCH_CARDS,
        coverage,
        items,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "KINGMAKER workbench failed to load.",
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}
