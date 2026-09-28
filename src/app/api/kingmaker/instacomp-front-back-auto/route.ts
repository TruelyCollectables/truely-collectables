import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAccountFromRequest } from "../../../../lib/account-auth";
import { fetchInstaCompAiLocalScanImage } from "../../../../lib/instacomp-ai-local";
import type { InstaCompChecklistCandidate } from "../../../../lib/instacomp-checklist-first";
import { resolveInstaCompChecklistFirstFromRegistry } from "../../../../lib/instacomp-checklist-first-server";
import { resolveChecklistParallelFromVision } from "../../../../lib/instacomp-checklist-parallel-vision";
import { normalizeInstaCompSideImages } from "../../../../lib/instacomp-image-orientation";
import { assertSafeInstaCompRemoteImageUrl } from "../../../../lib/instacomp-provider-safety";
import {
  getMacMasterListingRow,
  updateMacKingmakerDraft,
} from "../../../../lib/kingmaker-mac-scan-server";
import { getInstaCompServiceToken } from "../../../../lib/tcos-profit-hunter-secrets";
import { POST as runInstaCompScan } from "../../instacomp/scan/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type JsonRecord = Record<string, unknown>;
type ImageRow = {
  image_url: string | null;
  alt_text: string | null;
  sort_order: number | null;
  is_primary: boolean | null;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown, maximum = 2_000) {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maximum) : null;
}

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}/]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validateFile(file: File, side: "front" | "back") {
  if (!file.size || file.size > MAX_IMAGE_BYTES) {
    throw new Error(`${side} image is empty or larger than 12MB.`);
  }
  const type = file.type.split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error(`${side} image is not JPEG, PNG, or WebP.`);
  }
  return file;
}

function selectedPair(rows: ImageRow[]) {
  const images = rows
    .map((row) => ({
      url: text(row.image_url),
      alt: text(row.alt_text, 300),
      order: Number(row.sort_order || 0),
      primary: row.is_primary === true,
    }))
    .filter(
      (
        row,
      ): row is {
        url: string;
        alt: string | null;
        order: number;
        primary: boolean;
      } => Boolean(row.url),
    )
    .sort((left, right) => {
      if (left.primary !== right.primary) return left.primary ? -1 : 1;
      return left.order - right.order;
    });
  const front =
    images.find((image) => /\bfront\b/i.test(image.alt || "")) ||
    images.find((image) => image.primary) ||
    images[0] ||
    null;
  const back =
    images.find(
      (image) =>
        /\bback\b/i.test(image.alt || "") && image.url !== front?.url,
    ) ||
    images.find((image) => !image.primary && image.url !== front?.url) ||
    images.find((image) => image.url !== front?.url) ||
    null;
  return { front, back, count: images.length };
}


function macStoredImageRows(item: JsonRecord, metadata: JsonRecord): ImageRow[] {
  const instaComp = record(metadata.instacomp);
  const recovered = record(instaComp.recoveredImageUrls);
  const sourceImages = Array.isArray(instaComp.sourceImageUrls)
    ? instaComp.sourceImageUrls
    : [];
  const front =
    text(instaComp.frontImageUrl, 2_000) ||
    text(recovered.front, 2_000) ||
    text(sourceImages[0], 2_000) ||
    text(item.image_url ?? item.imageUrl, 2_000);
  const back =
    text(instaComp.backImageUrl, 2_000) ||
    text(recovered.back, 2_000) ||
    text(sourceImages[1], 2_000);
  const rows: ImageRow[] = [];
  if (front) rows.push({ image_url: front, alt_text: "front", sort_order: 0, is_primary: true });
  if (back && back !== front) rows.push({ image_url: back, alt_text: "back", sort_order: 1, is_primary: false });
  return rows;
}

async function downloadImage(url: string, side: "front" | "back") {
  const response = await fetch(assertSafeInstaCompRemoteImageUrl(url), {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "TCOS-InstaComp-AutoOrientation/2.0" },
  });
  if (!response.ok) {
    throw new Error(`${side} image returned HTTP ${response.status}.`);
  }
  const bytes = await response.arrayBuffer();
  const type =
    response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ||
    "image/jpeg";
  const extension =
    type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  return validateFile(new File([bytes], `${side}.${extension}`, { type }), side);
}

async function digest(file: File) {
  return createHash("sha256")
    .update(Buffer.from(await file.arrayBuffer()))
    .digest("hex");
}

function titleCardNumber(value: string) {
  const labeled = value.match(
    /(?:#|card\s*(?:no\.?|number)?\s*[:#.-]?)\s*([a-z]{0,6}-?\d{1,5}[a-z]{0,3})\b/i,
  )?.[1];
  return labeled || null;
}

function titleYear(value: string) {
  return value.match(/\b((?:19|20)\d{2})\b/)?.[1] || null;
}

function titleManufacturer(value: string) {
  const names = [
    "Panini",
    "Bowman",
    "Topps",
    "Upper Deck",
    "Donruss",
    "Leaf",
    "Fleer",
    "Score",
    "SkyBox",
    "Pacific",
  ];
  const matches = names.filter((name) =>
    new RegExp(`\\b${name.replace(" ", "\\s+")}\\b`, "i").test(value),
  );
  return matches.length === 1 ? matches[0] : null;
}

function titlePlayer(value: string, cardNumber: string | null) {
  if (!cardNumber) return null;
  const escaped = cardNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(
      `#${escaped}\\s+(.+?)(?=\\s+(?:Base|Silver|Blue|Red|Green|Gold|Orange|Purple|Pink|Black|White|Cracked|Velocity|Wave|Auto|Autograph|Rookie|RC)\\b|$)`,
      "i",
    ).exec(value)?.[1]?.trim() || null
  );
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTrailingChecklistParallel(
  value: string,
  candidates: InstaCompChecklistCandidate[],
) {
  const rookie = value.match(/\s+(RC|Rookie)\s*$/i)?.[1] || null;
  let next = rookie
    ? value.replace(/\s+(?:RC|Rookie)\s*$/i, "").trim()
    : value.trim();
  const listed = Array.from(
    new Set(
      candidates
        .map((candidate) => String(candidate.parallel || "Base").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => right.length - left.length);

  let changed = true;
  while (changed) {
    changed = false;
    for (const parallel of listed) {
      const pattern = new RegExp(
        `\\s+(?:Base\\s+)?${escapeRegex(parallel)}\\s*$`,
        "i",
      );
      if (pattern.test(next)) {
        next = next.replace(pattern, "").trim();
        changed = true;
        break;
      }
    }
  }

  return { title: next, rookie };
}

function titleWithChecklistParallel(
  title: string,
  candidates: InstaCompChecklistCandidate[],
  selected: InstaCompChecklistCandidate,
) {
  const stripped = stripTrailingChecklistParallel(title, candidates);
  const parallel = selected.parallel || "Base";
  return [stripped.title, parallel, stripped.rookie]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function candidateAi(candidate: InstaCompChecklistCandidate, ai: JsonRecord) {
  const parallel = candidate.parallel || "Base";
  const storedParallel = normalized(parallel) === "base" ? null : parallel;
  return {
    ...ai,
    year: candidate.year,
    manufacturer: candidate.manufacturer,
    brand: candidate.brand || candidate.manufacturer,
    setName: candidate.setName || candidate.product || null,
    cardNumber: candidate.cardNumber,
    card_number: candidate.cardNumber,
    player: candidate.player,
    playerName: candidate.player,
    parallel: storedParallel,
    parallelName: storedParallel,
    checklistParallel: parallel,
    variation: candidate.variation || null,
    isAuto: candidate.isAuto,
    isRelic: candidate.isRelic,
    team: candidate.team || null,
    sport: candidate.sport || null,
    checklistIdentityId: candidate.identityId,
    checklistFingerprintSha256: candidate.fingerprintSha256 || null,
  };
}

async function saveFailure(params: {
  inventoryItemId: string;
  error: string;
  code: string;
  stage: string;
}) {
  if (!params.inventoryItemId) return;
  try {
    const item = await getMacMasterListingRow(params.inventoryItemId);
    if (!item) return;
    const metadata = record(item.metadata);
    const instacomp = record(metadata.instacomp);
    await updateMacKingmakerDraft(params.inventoryItemId, {
      metadata: {
        ...metadata,
        instacomp: {
          ...instacomp,
          lastStatus: "failed",
          lastStage: params.stage,
          lastError: params.error,
          lastErrorCode: params.code,
          lastFailedAt: new Date().toISOString(),
        },
      },
    });
  } catch {
    // Preserve the original error.
  }
}

export async function POST(request: NextRequest) {
  let inventoryItemId = "";

  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }
    const isOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    if (!isOwner) {
      return NextResponse.json(
        {
          success: false,
          error: "KINGMAKER image and identity repair is owner-only.",
        },
        { status: 403 },
      );
    }

    const multipart =
      request.headers.get("content-type")?.includes("multipart/form-data") ===
      true;
    const body = multipart
      ? await request.formData()
      : await request.json().catch(() => ({}));
    const value = (key: string) =>
      multipart ? body.get(key) : (body as JsonRecord)?.[key];
    inventoryItemId = String(value("inventoryItemId") || "").trim();
    if (!inventoryItemId) {
      return NextResponse.json(
        { success: false, error: "Choose a card to scan." },
        { status: 400 },
      );
    }

    const item = await getMacMasterListingRow(inventoryItemId);
    if (!item) {
      return NextResponse.json(
        {
          success: false,
          error: "The selected Mac-local KINGMAKER card was not found.",
        },
        { status: 404 },
      );
    }
    if (item.status === "archived" || item.status === "sold") {
      return NextResponse.json(
        {
          success: false,
          error: "This card is archived or sold and cannot be rescanned.",
        },
        { status: 409 },
      );
    }

    const metadata = record(item.metadata);
    const previousInstaComp = record(metadata.instacomp);
    if (
      previousInstaComp.manualIdentityLocked === true &&
      value("replaceManualIdentity") !== true &&
      value("replaceManualIdentity") !== "true"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "This corrected identity is locked. Unlock it before automatic replacement.",
          code: "MANUAL_IDENTITY_LOCKED",
        },
        { status: 409 },
      );
    }

    const pair = selectedPair(macStoredImageRows(item, metadata));
    const previousMacReceipt = record(previousInstaComp.macReceipt);
    const storedMacScanId = text(
      previousInstaComp.scanId ?? previousMacReceipt.scanId,
      100,
    );
    if (
      !storedMacScanId &&
      (!pair.front?.url || !pair.back?.url || pair.front.url === pair.back.url)
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "One distinct stored front and one distinct stored back are required.",
          code: "INVALID_STORED_PAIR",
        },
        { status: 409 },
      );
    }

    let frontFile: File;
    let backFile: File;
    const providedFront = multipart ? value("frontImage") : null;
    const providedBack = multipart ? value("backImage") : null;
    const hasProvidedPair =
      providedFront instanceof File &&
      providedFront.size > 0 &&
      providedBack instanceof File &&
      providedBack.size > 0;
    if (hasProvidedPair) {
      frontFile = validateFile(providedFront, "front");
      backFile = validateFile(providedBack, "back");
    } else if (storedMacScanId) {
      [frontFile, backFile] = await Promise.all([
        fetchInstaCompAiLocalScanImage({
          scanId: storedMacScanId,
          side: "front",
          timeoutMs: 20_000,
        }),
        fetchInstaCompAiLocalScanImage({
          scanId: storedMacScanId,
          side: "back",
          timeoutMs: 20_000,
        }),
      ]);
    } else {
      [frontFile, backFile] = await Promise.all([
        downloadImage(pair.front!.url, "front"),
        downloadImage(pair.back!.url, "back"),
      ]);
    }

    const normalizedSides = await normalizeInstaCompSideImages({
      frontImage: frontFile,
      backImage: backFile,
    });
    if (!normalizedSides.backFile) {
      throw new Error("Back orientation normalization returned no image.");
    }
    const [frontSha256, backSha256] = await Promise.all([
      digest(normalizedSides.frontFile),
      digest(normalizedSides.backFile),
    ]);
    if (frontSha256 === backSha256) {
      return NextResponse.json(
        {
          success: false,
          error: "Front and back normalized to the same image bytes.",
          code: "DUPLICATE_NORMALIZED_IMAGES",
        },
        { status: 409 },
      );
    }

    let storedImages = {
      frontImageUrl: storedMacScanId
        ? `/api/kingmaker/scan-image?scanId=${encodeURIComponent(storedMacScanId)}&side=front`
        : pair.front?.url || null,
      backImageUrl: storedMacScanId
        ? `/api/kingmaker/scan-image?scanId=${encodeURIComponent(storedMacScanId)}&side=back`
        : pair.back?.url || null,
      verified: Boolean(storedMacScanId),
      source: storedMacScanId ? "mac_local_scan_archive" : "existing_mac_pair",
      orientation: normalizedSides.orientation,
    };

    const serviceToken = getInstaCompServiceToken();
    if (!serviceToken) {
      throw new Error("The internal InstaComp service credential is missing.");
    }
    const scanForm = new FormData();
    scanForm.set("frontImage", normalizedSides.frontFile);
    scanForm.set("backImage", normalizedSides.backFile);
    scanForm.set(
      "aiCouncilTier",
      String(value("aiCouncilTier") || "adaptive"),
    );
    const scanRequest = new NextRequest("http://localhost/api/instacomp/scan", {
      method: "POST",
      headers: { "x-tcos-instacomp-service-token": serviceToken },
      body: scanForm,
    });
    const scanResponse = await runInstaCompScan(scanRequest);
    const scanPayload = await scanResponse.json().catch(() => ({}));
    if (!scanResponse.ok || scanPayload?.ok !== true || !scanPayload?.ai) {
      const scanError =
        text(scanPayload?.error, 1_000) || "Identity scan failed.";
      const scanCode =
        text(scanPayload?.code, 120) || `HTTP_${scanResponse.status}`;
      await saveFailure({
        inventoryItemId,
        error: scanError,
        code: scanCode,
        stage: "identity_scan",
      });
      return NextResponse.json(
        {
          success: false,
          error: scanError,
          code: scanCode,
          imageOrientation: normalizedSides.orientation,
          normalizedImages: storedImages,
          imagesPreserved: true,
        },
        { status: scanResponse.status || 500 },
      );
    }

    const localScanId = text(scanPayload.scanId, 200);
    if (localScanId) {
      storedImages = {
        frontImageUrl: `/api/kingmaker/scan-image?scanId=${encodeURIComponent(localScanId)}&side=front`,
        backImageUrl: `/api/kingmaker/scan-image?scanId=${encodeURIComponent(localScanId)}&side=back`,
        verified: true,
        source: "mac_local_scan_archive",
        orientation: normalizedSides.orientation,
      };
    }

    const ai = record(scanPayload.ai);
    const title = String(item.title || "");
    const cardNumber =
      text(ai.cardNumber || ai.card_number, 80) || titleCardNumber(title);
    const broadDecision = await resolveInstaCompChecklistFirstFromRegistry({
      year: text(ai.year, 20) || titleYear(title),
      manufacturer:
        text(ai.manufacturer || ai.brand, 120) || titleManufacturer(title),
      cardNumber,
      player:
        text(ai.player || ai.playerName, 180) ||
        titlePlayer(title, cardNumber),
      serialNumber: null,
      isAuto: null,
      isRelic: null,
      parallel: null,
      variation: null,
      ocrText: [
        title,
        text(ai.notes, 2_000),
        text(ai.frontText || ai.frontVisibleText, 2_000),
        text(ai.backText || ai.backVisibleText || ai.backEvidence, 2_000),
        ...normalizedSides.orientation.frontEvidenceText,
        ...normalizedSides.orientation.backEvidenceText,
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 12_000),
    });

    const candidates = broadDecision.match
      ? [broadDecision.match]
      : broadDecision.candidates;
    const parallelDecision = await resolveChecklistParallelFromVision({
      frontDataUrl: normalizedSides.frontDataUrl,
      backDataUrl: normalizedSides.backDataUrl,
      candidates,
    });
    const selected = candidates.find(
      (candidate) =>
        candidate.identityId === parallelDecision.selectedIdentityId,
    );
    const identityComplete = Boolean(selected);
    const resolvedAi = selected ? candidateAi(selected, ai) : ai;
    const nextTitle = selected
      ? titleWithChecklistParallel(title, candidates, selected)
      : title;
    const checkedAt = new Date().toISOString();
    const collectibleAsset = record(metadata.collectible_asset);
    const selectedParallel = selected?.parallel || null;
    const selectedIsBase = normalized(selectedParallel) === "base";
    const nextMetadata = {
      ...metadata,
      collectible_asset: {
        ...collectibleAsset,
        parallel_name:
          selected && !selectedIsBase
            ? selectedParallel
            : selected
              ? null
              : collectibleAsset.parallel_name || null,
      },
      instacomp: {
        ...previousInstaComp,
        schema: "truely.instacompInventoryIdentity.v4",
        scanId: scanPayload.scanId || null,
        ai: resolvedAi,
        review: scanPayload.review || null,
        imageOrientation: normalizedSides.orientation,
        imageOrientationVerified:
          normalizedSides.orientation.status === "completed",
        imageOrientationPersisted:
          normalizedSides.orientation.status === "completed",
        imagePersistenceVerified: storedImages.verified === true,
        frontImageUrl: storedImages.frontImageUrl,
        backImageUrl: storedImages.backImageUrl,
        frontSha256,
        backSha256,
        checklistDecision: {
          status: broadDecision.status,
          reasons: broadDecision.reasons,
          candidateCount: candidates.length,
          candidateIdentityIds: candidates.map(
            (candidate) => candidate.identityId,
          ),
        },
        parallelDecision,
        identitySource: selected
          ? "checklist_constrained_front_back_vision"
          : "front_back_scan_review_required",
        identityComplete,
        identityRuleApplied: selected
          ? "checklist_constrained_visual_parallel"
          : null,
        hasBackImage: true,
        humanVerified: false,
        trustedForIdentity: false,
        manualIdentityEdit: false,
        manualIdentityLocked: false,
        identityRefreshRequired: !identityComplete,
        pricingStatus: identityComplete
          ? "identity_complete_pricing_pending"
          : "blocked_identity_review_required",
        pricingReason: identityComplete
          ? "One checklist identity was visually resolved. Pricing remains separate."
          : "Checklist identity remains ambiguous. Base was not assumed and pricing is blocked.",
        lastStatus: identityComplete
          ? "identity_complete"
          : "review_required",
        lastStage: identityComplete ? "complete" : "parallel_review",
        lastError: null,
        lastErrorCode: null,
        scannedAt: checkedAt,
      },
    };

    await updateMacKingmakerDraft(inventoryItemId, {
      title: nextTitle,
      player: resolvedAi.player || null,
      sport: resolvedAi.sport || null,
      metadata: nextMetadata,
    });

    return NextResponse.json({
      success: true,
      stage: identityComplete ? "complete" : "parallel_review",
      identityComplete,
      scanId: scanPayload.scanId || null,
      ai: resolvedAi,
      review: scanPayload.review || null,
      imageOrientation: normalizedSides.orientation,
      normalizedImages: storedImages,
      checklistDecision: broadDecision,
      parallelDecision,
      pricingStatus: identityComplete
        ? "identity_complete_pricing_pending"
        : "blocked_identity_review_required",
      nothingPublished: true,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Automatic orientation and checklist identity scan failed.";
    await saveFailure({
      inventoryItemId,
      error: message,
      code: "INSTACOMP_AUTO_SCAN_FAILED",
      stage: "automatic_pipeline",
    });
    return NextResponse.json(
      {
        success: false,
        error: message,
        code: "INSTACOMP_AUTO_SCAN_FAILED",
      },
      { status: 500 },
    );
  }
}
