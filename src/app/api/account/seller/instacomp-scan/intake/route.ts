import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import {
  analyzeWithInstaCompAiLocal,
  type InstaCompAiLocalScan,
} from "../../../../../../lib/instacomp-ai-local";
import { buildInstaCompChannelDraft } from "../../../../../../lib/instacomp-channel-draft";
import {
  applyInstaCompListingOutput,
  buildInstaCompListingOutput,
  type InstaCompAiInscriptionFields,
} from "../../../../../../lib/instacomp-listing-output";
import type { InstaCompAiResult } from "../../../../../../lib/instacomp";
import { normalizeInstaCompSideImages } from "../../../../../../lib/instacomp-image-orientation";
import { persistNormalizedInstaCompImagePair } from "../../../../../../lib/instacomp-normalized-image-storage";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";
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

function canonicalFields(identity: Record<string, unknown>) {
  return {
    sport: text(identity.sport, 80),
    league: text(identity.league, 80),
    year: text(identity.year, 20),
    manufacturer: text(identity.manufacturer || identity.brand, 100),
    brand: text(identity.brand, 100),
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
  return [
    fields.year,
    fields.manufacturer,
    fields.setName,
    fields.player,
    fields.cardNumber ? `#${fields.cardNumber}` : null,
    fields.parallel,
    fields.isRookie ? "Rookie" : null,
    fields.isAuto ? "Auto" : null,
    fields.isRelic ? "Relic" : null,
  ]
    .filter(Boolean)
    .join(" ");
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
    const normalizedSides = await normalizeInstaCompSideImages({
      frontImage: frontFile,
      backImage: backFile,
    });
    if (!normalizedSides.backFile) {
      throw new Error("Back image normalization did not return an image.");
    }
    const scan = await analyzeWithInstaCompAiLocal({
      front: normalizedSides.frontFile,
      back: normalizedSides.backFile,
    });
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

    let fields = canonicalFields(identity);
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

    const isWnbaProduct = /\bwnba\b/i.test(
      [fields.league, fields.setName].filter(Boolean).join(" "),
    );
    const claimsPrizmParallel = Boolean(
      fields.parallel &&
        /\b(?:silver|green|red|blue|gold|orange|purple|pink|black|white|ice|wave|velocity|cracked\s+ice)(?:\s+prizm)?\b/i.test(
          fields.parallel,
        ),
    );
    const forcedBaseFromBack =
      isWnbaProduct &&
      claimsPrizmParallel &&
      normalizedSides.orientation.backStandalonePrizm === false &&
      normalizedSides.orientation.backDesignationConfidence >= 0.8;
    if (forcedBaseFromBack) {
      fields = { ...fields, parallel: null, variation: null };
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

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const { data: existingRows, error: duplicateError } = await supabase
      .from("inventory_items")
      .select("id,title,status,metadata")
      .eq("store_id", storeId)
      .eq("seller_account_id", account.id)
      .contains("metadata", { instacomp: { imagePairSha256 } })
      .limit(1);
    if (duplicateError) throw duplicateError;
    const duplicate = existingRows?.[0] || null;
    if (duplicate) {
      return NextResponse.json(
        {
          success: false,
          code: "DUPLICATE_SCAN",
          error: "This exact front/back image pair already exists in inventory.",
          duplicate: {
            inventoryItemId: duplicate.id,
            title: duplicate.title,
            status: duplicate.status,
          },
          scan,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

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
    const metadata = {
      instacomp: {
        source: "mac_registry_scanner",
        scanId: scan.scan_id,
        imagePairSha256,
        frontSha256,
        backSha256,
        hasBackImage: true,
        imageRequirement: "front_and_back_required_for_listing",
        humanVerified: false,
        pricingStatus: "not_run",
        publicationStatus: listingOutput.publicationStatus,
        publicationReviewReasons: listingOutput.publicationReviewReasons,
        listingOutput,
        channelDraft,
        scanReceipt: scan,
        imageOrientation: normalizedSides.orientation,
        identityRuleApplied: forcedBaseFromBack
          ? "wnba_back_without_standalone_prizm_forced_base"
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
        checklistIdentity: {
          status: "identified",
          source: "checklist_registry",
          registryIdentityId,
          registryFingerprintSha256: registryFingerprint,
          checkedAt,
          reasons: scan.checklist?.reasons || [],
          lockedFields: fields,
        },
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
    };

    const { data: inserted, error: insertError } = await supabase
      .from("inventory_items")
      .insert({
        store_id: storeId,
        seller_account_id: account.id,
        title: appliedListing.title,
        description: appliedListing.description,
        category: "Trading Card Singles",
        condition: grading.condition,
        status: "draft",
        quantity: 1,
        price: 0,
        metadata,
      })
      .select("id,title,status,price,metadata")
      .single();
    if (insertError) throw insertError;

    const persistedImages = await persistNormalizedInstaCompImagePair({
      supabase,
      storeId,
      inventoryItemId: inserted.id,
      title: inserted.title,
      frontFile: normalizedSides.frontFile,
      backFile: normalizedSides.backFile,
      orientation: normalizedSides.orientation,
    });

    const requestId = `scan-${scan.scan_id}`;
    const pricingRequest = new NextRequest(
      new URL(
        "/api/account/seller/inventory/instacomp-verified",
        request.url,
      ),
      {
        method: "POST",
        headers: forwardedHeaders(request, requestId),
        body: JSON.stringify({
          inventoryItemId: inserted.id,
          aiCouncilTier: "adaptive",
          requestId,
        }),
      },
    );
    const pricingResponse = await runVerifiedPricing(pricingRequest);
    const pricing = await pricingResponse.json().catch(() => ({}));

    return NextResponse.json(
      {
        success: true,
        inventoryItemId: inserted.id,
        title: inserted.title,
        listingOutput,
        channelDraft,
        scan,
        pricing,
        pricingSucceeded: pricingResponse.ok,
        imageOrientation: normalizedSides.orientation,
        normalizedImages: persistedImages,
        identityRuleApplied: forcedBaseFromBack
          ? "wnba_back_without_standalone_prizm_forced_base"
          : null,
        durationMs: Date.now() - startedAt,
      },
      {
        status: pricingResponse.ok ? 201 : 207,
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
