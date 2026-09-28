import { after, NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import {
  analyzeWithInstaCompAiLocal,
  type InstaCompAiLocalScan,
} from "../../../../../../lib/instacomp-ai-local";
import { buildInstaCompChannelDraft } from "../../../../../../lib/instacomp-channel-draft";
import { buildInstaCompCanonicalTitle } from "../../../../../../lib/instacomp-canonical-title";
import {
  applyInstaCompListingOutput,
  buildInstaCompListingOutput,
  type InstaCompAiInscriptionFields,
} from "../../../../../../lib/instacomp-listing-output";
import type { InstaCompAiResult } from "../../../../../../lib/instacomp";
import { normalizeInstaCompRotation } from "../../../../../../lib/instacomp-image-orientation";
import type { InstaCompImageOrientationReceipt } from "../../../../../../lib/instacomp-normalized-image-storage";
import {
  createMacKingmakerDraft,
  findMacDuplicateByImagePair,
  findMacKingmakerByCardUuid,
  listMacMasterListingGroup,
} from "../../../../../../lib/kingmaker-mac-scan-server";
import { POST as runVerifiedPricing } from "../../inventory/instacomp-verified/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function text(value: unknown, max = 240) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, max) : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textList(value: unknown, limit = 20) {
  return Array.isArray(value)
    ? value
        .map((item) => text(item, 240))
        .filter((item): item is string => Boolean(item))
        .slice(0, limit)
    : [];
}

function boundedConfidence(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

function standalonePrizmFromBackEvidence(value: unknown) {
  const lines = textList(value, 12);
  for (const raw of lines) {
    const candidate = raw
      .replace(/^back:/i, "")
      .replace(/[®™]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    // Copyright/product text containing Prizm is not a standalone designation.
    // Only a physically OCR'd standalone PRIZM line is positive finish evidence.
    if (/^prizm$/i.test(candidate)) {
      return { value: true as const, confidence: 0.95 };
    }
  }
  return { value: null, confidence: 0 };
}

function macOrientationReceipt(
  scan: InstaCompAiLocalScan,
  webOrientation: {
    backStandalonePrizm?: boolean | null;
    backDesignationConfidence?: number;
  },
): InstaCompImageOrientationReceipt {
  const receipt = scan.image_orientation || {};
  const frontConfidence = boundedConfidence(receipt.front_confidence);
  const backConfidence = boundedConfidence(receipt.back_confidence);
  const frontEvidenceText = textList(receipt.front_evidence, 8);
  const backEvidenceText = textList(receipt.back_evidence, 8);
  const completed =
    text(receipt.status, 80) === "completed" &&
    frontConfidence >= 0.90 &&
    backConfidence >= 0.90 &&
    frontEvidenceText.length > 0 &&
    backEvidenceText.length > 0;

  const macDesignation = standalonePrizmFromBackEvidence(
    receipt.back_evidence,
  );
  const backStandalonePrizm =
    webOrientation.backStandalonePrizm ?? macDesignation.value;
  const backDesignationConfidence = Math.max(
    boundedConfidence(webOrientation.backDesignationConfidence),
    macDesignation.confidence,
  );

  return {
    status: completed ? "completed" : "review_required",
    model: text(receipt.source, 100) || "mac_apple_vision_ocr",
    source: text(receipt.source, 100) || "mac_apple_vision_ocr",
    frontRotation: normalizeInstaCompRotation(receipt.front_rotation),
    backRotation: normalizeInstaCompRotation(receipt.back_rotation),
    frontConfidence,
    backConfidence,
    frontEvidenceText,
    backEvidenceText,
    backStandalonePrizm,
    backDesignationConfidence,
    reason: completed
      ? "The Mac normalized each archived side with Apple Vision text-orientation evidence before website storage."
      : "The Mac did not return decisive orientation evidence for both sides, so this card is held outside listing intake.",
  };
}

function booleanEvidence(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/^(true|yes|confirmed|observed)$/i.test(value.trim())) return true;
    if (/^(false|no|not_observed)$/i.test(value.trim())) return false;
  }
  return null;
}

function lockedIdentity(scan: InstaCompAiLocalScan) {
  const identity = scan.trusted_identity;
  return identity && typeof identity === "object" && !Array.isArray(identity)
    ? (identity as Record<string, unknown>)
    : null;
}

function receiptValue(scan: InstaCompAiLocalScan, prefix: string) {
  return (
    scan.checklist?.source_receipts
      ?.find((value: string) => value.startsWith(prefix))
      ?.slice(prefix.length) || null
  );
}

function physicalCardUuid(scan: InstaCompAiLocalScan) {
  const value = text(scan.card_uuid, 64)?.toLowerCase() || null;
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    ? value
    : null;
}

function inventoryItemHref(inventoryItemId: string) {
  const encoded = encodeURIComponent(inventoryItemId);
  return `/seller/admin/inventory/${encoded}?inventoryItemId=${encoded}`;
}

function canonicalFields(identity: Record<string, unknown>) {
  return {
    sport: text(identity.sport, 80),
    league: text(identity.league, 80),
    year: text(identity.year, 20),
    manufacturer: text(identity.manufacturer || identity.brand, 100),
    brand: text(identity.brand, 100),
    product: text(identity.product || identity.brand, 120),
    setName: text(identity.set_name, 160),
    player: text(identity.player, 180),
    team: text(identity.team, 160),
    cardNumber: text(identity.card_number, 80),
    parallel: text(identity.parallel, 160),
    variation: text(identity.variation, 160),
    serialNumber: text(identity.serial_number, 80),
    serialRun:
      typeof identity.serial_run === "number" ? identity.serial_run : null,
    isRookie: identity.rookie === true,
    isAuto: identity.autograph === true,
    isRelic: identity.memorabilia === true,
  };
}

function titleFor(fields: ReturnType<typeof canonicalFields>) {
  return buildInstaCompCanonicalTitle({
    year: fields.year,
    manufacturer: fields.manufacturer,
    brand: fields.brand,
    product: fields.product,
    setName: fields.setName,
    cardNumber: fields.cardNumber,
    player: fields.player,
    parallel: fields.parallel,
    variation: fields.variation,
    serialRun: fields.serialRun,
    serialNumber: fields.serialNumber,
    isRookie: fields.isRookie,
    isAuto: fields.isAuto,
    isRelic: fields.isRelic,
  });
}

function localEvidenceRecords(scan: InstaCompAiLocalScan) {
  const raw = recordValue(scan.local_suggestion?.raw);
  return [
    raw,
    recordValue(raw.inscription),
    recordValue(raw.grading),
    recordValue(raw.grade),
    recordValue(raw.slab),
    recordValue(raw.collectible),
    recordValue(raw.card),
  ];
}

function localEvidenceValue(scan: InstaCompAiLocalScan, aliases: string[]) {
  for (const record of localEvidenceRecords(scan)) {
    for (const alias of aliases) {
      if (record[alias] !== undefined && record[alias] !== null) {
        return record[alias];
      }
    }
  }
  return null;
}

function localEvidenceNotes(scan: InstaCompAiLocalScan) {
  const evidence = scan.local_suggestion?.evidence || {};
  const values = [
    text(scan.local_suggestion?.explanation, 1000),
    ...textList(evidence.front_notes),
    ...textList(evidence.back_notes),
    ...textList(evidence.uncertainty),
  ].filter((value): value is string => Boolean(value));
  return values.length ? Array.from(new Set(values)).join("; ") : null;
}

function localVisibleText(scan: InstaCompAiLocalScan) {
  const values = textList(scan.local_suggestion?.evidence?.visible_text, 40);
  return values.length ? values.join("; ") : null;
}

function localGradingEvidence(scan: InstaCompAiLocalScan) {
  const gradingCompany = text(
    localEvidenceValue(scan, [
      "gradingCompany",
      "grading_company",
      "grader",
      "grading_service",
    ]),
    80,
  );
  const gradeValue = text(
    localEvidenceValue(scan, [
      "gradingGrade",
      "grading_grade",
      "gradeValue",
      "grade_value",
      "grade",
    ]),
    40,
  );
  const certificationNumber = text(
    localEvidenceValue(scan, [
      "gradingCertNumber",
      "grading_cert_number",
      "certificationNumber",
      "certification_number",
      "certNumber",
      "cert_number",
    ]),
    100,
  );
  const observed = Boolean(
    gradingCompany || gradeValue || certificationNumber,
  );
  return {
    gradingCompany,
    gradeValue,
    certificationNumber,
    condition:
      gradingCompany && (gradeValue || certificationNumber)
        ? "Graded"
        : "Ungraded",
    verificationStatus: gradingCompany ? "required" : "not_applicable",
    observed,
  };
}

function localInscriptionEvidence(
  scan: InstaCompAiLocalScan,
): InstaCompAiInscriptionFields {
  const isInscribed = booleanEvidence(
    localEvidenceValue(scan, ["isInscribed", "is_inscribed", "inscribed"]),
  );
  const inscriptionText = text(
    localEvidenceValue(scan, [
      "inscriptionText",
      "inscription_text",
      "handwrittenText",
      "handwritten_text",
    ]),
    120,
  );
  const confidenceValue = localEvidenceValue(scan, [
    "inscriptionConfidence",
    "inscription_confidence",
  ]);
  const inscriptionConfidence =
    confidenceValue === null ? null : boundedConfidence(confidenceValue);
  return { isInscribed, inscriptionText, inscriptionConfidence };
}

function listingAiResult(
  fields: ReturnType<typeof canonicalFields>,
  scan: InstaCompAiLocalScan,
  grading: ReturnType<typeof localGradingEvidence>,
): InstaCompAiResult & InstaCompAiInscriptionFields {
  const inscription = localInscriptionEvidence(scan);
  return {
    player: fields.player,
    year: fields.year,
    brand: fields.brand || fields.manufacturer,
    setName: fields.setName,
    cardNumber: fields.cardNumber,
    parallel: fields.parallel,
    serialNumber: fields.serialNumber,
    gradingCompany: grading.gradingCompany,
    gradeValue: grading.gradeValue,
    certificationNumber: grading.certificationNumber,
    certificationLookupUrl: null,
    gradingEvidence: grading.observed
      ? "Observed by local scan; official grader verification remains required."
      : null,
    team: fields.team,
    sport: fields.sport,
    isRookie: fields.isRookie,
    isAuto: fields.isAuto,
    isRelic: fields.isRelic,
    conditionGuess: grading.condition,
    confidence: boundedConfidence(scan.local_suggestion?.confidence),
    notes: localEvidenceNotes(scan),
    ...inscription,
  };
}

function forwardedHeaders(request: NextRequest, requestId: string) {
  const headers = new Headers({
    "content-type": "application/json",
    "x-instacomp-request-id": requestId,
  });
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  if (authorization) headers.set("authorization", authorization);
  if (cookie) headers.set("cookie", cookie);
  return headers;
}

export async function POST(request: NextRequest) {
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

    const form = await request.formData();
    const front = form.get("front");
    const back = form.get("back");
    if (!(front instanceof Blob) || front.size <= 0) {
      return NextResponse.json(
        {
          success: false,
          code: "FRONT_IMAGE_REQUIRED",
          error: "Front image is required for every listing.",
        },
        { status: 400 },
      );
    }
    if (!(back instanceof Blob) || back.size <= 0) {
      return NextResponse.json(
        {
          success: false,
          code: "BACK_IMAGE_REQUIRED",
          error:
            "Back image is required for every listing. One-photo InstaComp is allowed only outside the listing intake workflow.",
        },
        { status: 400 },
      );
    }

    const frontFile = front;
    const backFile = back;

    // Seller intake is Mac-local first. Do not block every physical card on a
    // second remote OpenAI orientation pass before the real Registry scan even
    // starts. The Mac applies Apple Vision orientation to the archived pixels
    // and returns the fail-closed orientation receipt used below.
    const scan = await analyzeWithInstaCompAiLocal({
      front: frontFile,
      back: backFile,
      frontRotation: null,
      backRotation: null,
      timeoutMs: 75_000,
    });
    const macImageOrientation = macOrientationReceipt(scan, {});
    const cardUuid = physicalCardUuid(scan);
    if (!cardUuid) {
      return NextResponse.json(
        {
          success: false,
          code: "PHYSICAL_CARD_UUID_REQUIRED",
          error:
            "InstaComp did not return a valid permanent UUID for this physical card.",
          scan,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    const identity = lockedIdentity(scan);
    const registryIdentityId =
      scan.checklist?.identity_id || receiptValue(scan, "registry_identity:");
    const registryFingerprint = receiptValue(scan, "registry_fingerprint:");

    if (
      !scan.pricing_allowed ||
      !identity ||
      !registryIdentityId ||
      !registryFingerprint
    ) {
      return NextResponse.json(
        {
          success: false,
          code: "CHECKLIST_IDENTITY_REQUIRED",
          error:
            scan.next_action ||
            "Checklist Registry review is required before pricing.",
          scan,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const fields = canonicalFields(identity);
    if (
      !fields.year ||
      !fields.manufacturer ||
      !fields.cardNumber ||
      !fields.player
    ) {
      return NextResponse.json(
        {
          success: false,
          code: "INCOMPLETE_REGISTRY_RECEIPT",
          error: "Registry receipt is missing canonical publish fields.",
          scan,
        },
        { status: 409 },
      );
    }

    // 2025 Select WNBA has a physically validated Base-vs-parallel witness:
    // parallel backs carry a standalone PRIZM designation while Base backs do not.
    // This witness is contradiction-only: it never rewrites Registry identity.
    const selectBackMarkerUsable =
      /^2025/.test(fields.year || "") &&
      /select/i.test(fields.brand || fields.product || "") &&
      /wnba/i.test(fields.league || "") &&
      typeof macImageOrientation.backStandalonePrizm === "boolean" &&
      Number(macImageOrientation.backDesignationConfidence || 0) >= 0.90;
    const registryClaimsParallel = Boolean(
      fields.parallel && !/^Base(?: Set)?$/i.test(fields.parallel),
    );
    const selectBackMarkerConflict = selectBackMarkerUsable && (
      (macImageOrientation.backStandalonePrizm === true && !registryClaimsParallel) ||
      (macImageOrientation.backStandalonePrizm === false && registryClaimsParallel)
    );
    if (selectBackMarkerConflict) {
      return NextResponse.json(
        {
          success: false,
          code: "PHYSICAL_FINISH_CONFLICT",
          error:
            "The physical 2025 Select back disagrees with the Registry Base/parallel state. The card is held for finish verification; its Registry identity was not rewritten.",
          scan,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const imagePairSha256 = text(scan.image_pair_sha256, 128);
    const frontSha256 = text(scan.front_sha256, 128);
    const backSha256 = text(scan.back_sha256, 128);
    if (!imagePairSha256 || !frontSha256 || !backSha256) {
      return NextResponse.json(
        {
          success: false,
          code: "INCOMPLETE_SCAN_RECEIPT",
          error:
            "The Mac scan receipt must contain front, back, and paired image hashes before a listing can be created.",
          scan,
        },
        { status: 409 },
      );
    }
    if (frontSha256 === backSha256) {
      return NextResponse.json(
        {
          success: false,
          code: "FRONT_BACK_IMAGES_DUPLICATE",
          error:
            "Front and back photos must be different images. Retake the missing side before creating the listing.",
          scan,
        },
        { status: 409 },
      );
    }

    if (macImageOrientation.status !== "completed") {
      return NextResponse.json(
        {
          success: false,
          code: "IMAGE_ORIENTATION_REVIEW_REQUIRED",
          error: macImageOrientation.reason,
          scan,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    // KINGMAKER intake is Mac-local only. Duplicate guards and pricing-group
    // lookup hit indexed SQLite paths in parallel; no storefront database is
    // consulted for identity, inventory, or image authority.
    const [physicalDuplicate, duplicate, exactIdentityMatches] =
      await Promise.all([
        findMacKingmakerByCardUuid(cardUuid, 5_000),
        findMacDuplicateByImagePair(imagePairSha256, 5_000),
        listMacMasterListingGroup(registryFingerprint, {
          compact: false,
          timeoutMs: 5_000,
        }),
      ]);

    if (physicalDuplicate) {
      return NextResponse.json(
        {
          success: false,
          code: "DUPLICATE_PHYSICAL_CARD",
          error:
            "This physical card UUID is already in Mac-local KINGMAKER inventory. Its existing listing was kept instead of creating a duplicate.",
          duplicate: {
            inventoryItemId: physicalDuplicate.inventoryItemId,
            inventoryItemHref: inventoryItemHref(
              physicalDuplicate.inventoryItemId,
            ),
            legacyProductId: physicalDuplicate.legacyProductId,
            title: physicalDuplicate.title,
            status: physicalDuplicate.status,
            cardUuid,
            serialNumber: fields.serialNumber,
            serialRun: fields.serialRun,
          },
          scan,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (duplicate) {
      return NextResponse.json(
        {
          success: false,
          code: "DUPLICATE_SCAN",
          error:
            "This exact front/back image pair already exists in Mac-local KINGMAKER inventory.",
          duplicate: {
            inventoryItemId: duplicate.inventoryItemId,
            inventoryItemHref: inventoryItemHref(duplicate.inventoryItemId),
            title: duplicate.title,
            status: duplicate.status,
            cardUuid,
            serialNumber: fields.serialNumber,
            serialRun: fields.serialRun,
          },
          scan,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const activeGroupPrices = Array.from(
      new Set(
        exactIdentityMatches
          .filter((candidate) => String(candidate.status || "") === "active")
          .map((candidate) => Number(candidate.price || 0))
          .filter((candidatePrice) => candidatePrice > 0)
          .map((candidatePrice) => Math.round(candidatePrice * 100) / 100),
      ),
    );
    const inheritedGroupPrice =
      activeGroupPrices.length === 1 ? activeGroupPrices[0] : 0;

    const grading = localGradingEvidence(scan);
    const listingOutput = buildInstaCompListingOutput({
      ai: listingAiResult(fields, scan, grading),
      externalOcrText: localVisibleText(scan),
    });
    const baseTitle = titleFor(fields) || `InstaComp scan ${scan.scan_id}`;
    const appliedListing = applyInstaCompListingOutput({
      baseTitle,
      baseDescription:
        "Registry-locked InstaComp scan. Review all listing facts before publishing.",
      output: listingOutput,
    });
    const channelDraft = buildInstaCompChannelDraft({
      registryIdentityId,
      registryFingerprintSha256: registryFingerprint,
      content: {
        title: appliedListing.title,
        description: appliedListing.description,
        condition: grading.condition,
        quantity: 1,
      },
      listingOutput,
    });

    const checkedAt = new Date().toISOString();
    const frontImageUrl =
      `/api/kingmaker/scan-image?scanId=${encodeURIComponent(scan.scan_id)}&side=front`;
    const backImageUrl =
      `/api/kingmaker/scan-image?scanId=${encodeURIComponent(scan.scan_id)}&side=back`;
    const ai = {
      ...fields,
      checklistParallel: fields.parallel,
      internalScanId: scan.scan_id,
      internalCardUuid: cardUuid,
      registryIdentityId,
      registryFingerprintSha256: registryFingerprint,
      confidence: 0.99,
      exact: true,
    };
    const metadata = {
      instacomp: {
        source: "mac_registry_scanner",
        cardUuid,
        scanId: scan.scan_id,
        imagePairSha256,
        frontSha256,
        backSha256,
        hasBackImage: true,
        imageRequirement: "front_and_back_required_for_listing",
        frontImageUrl,
        backImageUrl,
        imagePersistenceVerified: true,
        imageOrientationPersisted: true,
        humanVerified: false,
        trustedForIdentity: true,
        identityComplete: true,
        identityRefreshRequired: false,
        identitySource: "mac_checklist_registry_exact",
        ai,
        pricingStatus: inheritedGroupPrice
          ? "priced_from_existing_exact_group"
          : "identity_complete_pricing_pending",
        listingPrice: inheritedGroupPrice || null,
        listingPriceSource: inheritedGroupPrice
          ? "existing_active_exact_card_group"
          : null,
        publicationStatus: listingOutput.publicationStatus,
        publicationReviewReasons: listingOutput.publicationReviewReasons,
        listingOutput,
        channelDraft,
        scanReceipt: scan,
        imageOrientation: macImageOrientation,
        pricingGroupKey: registryFingerprint,
        registryIdentityId,
        registryFingerprintSha256: registryFingerprint,
        duplicateGroup: {
          registryFingerprintSha256: registryFingerprint,
          existingRowCount: exactIdentityMatches.length,
          existingQuantity: exactIdentityMatches.reduce(
            (sum, candidate) =>
              sum + Math.max(0, Number(candidate.quantity || 0)),
            0,
          ),
          existingActiveCount: exactIdentityMatches.filter(
            (candidate) => String(candidate.status || "") === "active",
          ).length,
          existingProductIds: exactIdentityMatches
            .map(
              (candidate) =>
                candidate.legacyProductId || candidate.legacy_product_id,
            )
            .filter(Boolean),
          detectedAt: checkedAt,
          pricingTogether: true,
        },
        identityRuleApplied: selectBackMarkerUsable
          ? "2025_select_back_prizm_consistency_verified"
          : null,
        localEvidence: {
          provider: text(scan.local_suggestion?.provider, 100),
          model: text(scan.local_suggestion?.model, 100),
          confidence: boundedConfidence(scan.local_suggestion?.confidence),
          visibleText: textList(
            scan.local_suggestion?.evidence?.visible_text,
            40,
          ),
          uncertainty: textList(
            scan.local_suggestion?.evidence?.uncertainty,
            20,
          ),
        },
        checklistDecision: {
          status: "exact_match",
          source: "checklist_registry",
          candidateCount: 1,
          candidateIdentityIds: [registryIdentityId],
          reasons: scan.checklist?.reasons || [],
          checkedAt,
        },
        checklistIdentity: {
          status: "exact_match",
          source: "checklist_registry",
          identityId: registryIdentityId,
          registryIdentityId,
          fingerprintSha256: registryFingerprint,
          registryFingerprintSha256: registryFingerprint,
          checkedAt,
          reasons: scan.checklist?.reasons || [],
          lockedFields: fields,
        },
        parallelDecision: {
          status: "resolved",
          selectedParallel: fields.parallel || "Base",
          selectedIdentityId: registryIdentityId,
          confidence: 0.99,
          candidateParallels: [fields.parallel || "Base"],
        },
        macReceipt: {
          status: "trusted_memory_match",
          checklistOutcome: "exact_match",
          registryIdentityId,
          registryFingerprintSha256: registryFingerprint,
          scanId: scan.scan_id,
          checklistIdentity: fields,
          checkedAt,
        },
        lastStatus: "identity_complete",
        lastStage: "complete",
        lastError: null,
        lastErrorCode: null,
        scannedAt: checkedAt,
      },
      collectible_asset: {
        exact_serial_number: fields.serialNumber,
        serial_run: fields.serialRun,
        rookie: fields.isRookie,
        autograph: fields.isAuto,
        memorabilia: fields.isRelic,
        grading_company: grading.gradingCompany,
        grading_grade: grading.gradeValue,
        grading_cert_number: grading.certificationNumber,
        grader_verification_status: grading.verificationStatus,
      },
      seller_review: { identity_confirmed: false },
      listingWorkflow: {
        queue: "pending_listings",
        source: "mac_registry_exact_intake",
        updatedAt: checkedAt,
      },
      pending_verification: {
        status: "resolved",
        source: "mac_registry_exact_intake",
        resolvedAt: checkedAt,
      },
    };

    const inserted = await createMacKingmakerDraft({
      inventoryItemId: cardUuid,
      cardUuid,
      sku: `scan-${cardUuid.slice(0, 12)}`,
      title: appliedListing.title,
      description: appliedListing.description,
      player: fields.player,
      sport: fields.sport,
      category: "Trading Card Singles",
      condition: grading.condition,
      status: "draft",
      quantity: 1,
      price: inheritedGroupPrice,
      imageUrl: frontImageUrl,
      metadata,
    });
    if (!inserted?.inventoryItemId) {
      throw new Error(
        "Mac-local KINGMAKER draft was not returned after scanner intake.",
      );
    }

    const persistedImages = {
      frontImageUrl,
      backImageUrl,
      verified: true,
      source: "mac_local_scan_archive",
      orientation: macImageOrientation,
    };

    const requestId = `scan-${scan.scan_id}`;
    const pricingUrl = new URL(
      "/api/account/seller/inventory/instacomp-verified",
      request.url,
    ).toString();
    const pricingHeaders = forwardedHeaders(request, requestId);
    after(async () => {
      try {
        const pricingRequest = new NextRequest(pricingUrl, {
          method: "POST",
          headers: pricingHeaders,
          body: JSON.stringify({
            inventoryItemId: inserted.inventoryItemId,
            aiCouncilTier: "adaptive",
            requestId,
          }),
        });
        const pricingResponse = await runVerifiedPricing(pricingRequest);
        if (!pricingResponse.ok) {
          const payload = await pricingResponse.json().catch(() => ({}));
          console.error("KINGMAKER background pricing failed", {
            inventoryItemId: inserted.inventoryItemId,
            status: pricingResponse.status,
            error: payload?.error || payload?.message || null,
          });
        }
      } catch (error) {
        console.error("KINGMAKER background pricing crashed", {
          inventoryItemId: inserted.inventoryItemId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return NextResponse.json(
      {
        success: true,
        stage: "complete",
        identityComplete: true,
        cardUuid,
        inventoryItemId: inserted.inventoryItemId,
        title: inserted.title,
        listingOutput,
        channelDraft,
        scan,
        pricing: {
          status: "background_refresh_queued",
          suggestedPrice: inheritedGroupPrice || null,
        },
        pricingSucceeded: false,
        pricingBackgroundQueued: true,
        imageOrientation: macImageOrientation,
        normalizedImages: persistedImages,
        identityRuleApplied: selectBackMarkerUsable
          ? "2025_select_back_prizm_consistency_verified"
          : null,
        durationMs: Date.now() - startedAt,
      },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        code: "SCANNER_INTAKE_FAILED",
        error: error instanceof Error ? error.message : "Scanner intake failed.",
        durationMs: Date.now() - startedAt,
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
