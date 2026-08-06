import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../lib/account-auth";
import type { InstaCompChecklistCandidate } from "../../../../lib/instacomp-checklist-first";
import { resolveInstaCompChecklistFirstFromRegistry } from "../../../../lib/instacomp-checklist-first-server";
import { resolveChecklistParallelFromVision } from "../../../../lib/instacomp-checklist-parallel-vision";
import { normalizeInstaCompSideImages } from "../../../../lib/instacomp-image-orientation";
import { persistNormalizedInstaCompImagePair } from "../../../../lib/instacomp-normalized-image-storage";
import { assertSafeInstaCompRemoteImageUrl } from "../../../../lib/instacomp-provider-safety";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
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

async function downloadImage(url: string, side: "front" | "back") {
  const response = await fetch(assertSafeInstaCompRemoteImageUrl(url), {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "TCOS-InstaComp-ExactParallel/1.0" },
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

function titleYear(value: string) {
  return value.match(/\b((?:19|20)\d{2})\b/)?.[1] || null;
}

function titleCardNumber(value: string) {
  return (
    value.match(
      /(?:#|card\s*(?:no\.?|number)?\s*[:#.-]?)\s*([a-z]{0,6}-?\d{1,5}[a-z]{0,3})\b/i,
    )?.[1] || null
  );
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

function cleanSetName(candidate: InstaCompChecklistCandidate) {
  const manufacturer = String(candidate.manufacturer || "").trim();
  const setName = String(candidate.setName || candidate.product || "").trim();
  if (!manufacturer || !setName) return setName || null;
  return setName.replace(new RegExp(`^${manufacturer}\\s+`, "i"), "").trim();
}

function canonicalTitle(params: {
  candidate: InstaCompChecklistCandidate;
  ai: JsonRecord;
  currentTitle: string;
}) {
  const rookie =
    params.ai.isRookie === true || /\b(?:RC|Rookie)\b/i.test(params.currentTitle);
  return [
    params.candidate.year,
    params.candidate.manufacturer,
    cleanSetName(params.candidate),
    params.candidate.cardNumber ? `#${params.candidate.cardNumber}` : null,
    params.candidate.player,
    params.candidate.parallel || "Base",
    rookie ? "RC" : null,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function reviewTitle(params: {
  ai: JsonRecord;
  currentTitle: string;
  year: string | null;
  manufacturer: string | null;
  cardNumber: string | null;
  player: string | null;
}) {
  if (!/^(?:InstaComp scan pending|Untitled card)$/i.test(params.currentTitle)) {
    return params.currentTitle;
  }
  const setName = text(params.ai.setName || params.ai.set, 180);
  return [
    params.year,
    params.manufacturer,
    setName,
    params.cardNumber ? `#${params.cardNumber}` : null,
    params.player,
    "Parallel Review Required",
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim() || "InstaComp card — identity review required";
}

function candidateAi(candidate: InstaCompChecklistCandidate, ai: JsonRecord) {
  const exactParallel = candidate.parallel || "Base";
  const storedParallel = normalized(exactParallel) === "base" ? null : exactParallel;
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
    checklistParallel: exactParallel,
    variation: candidate.variation || null,
    serialNumber:
      text(record(ai.parallelVisualFeatures).serialStampText, 120) ||
      (candidate.serialRun ? `/${candidate.serialRun}` : null),
    printRun: candidate.serialRun ? `/${candidate.serialRun}` : null,
    isAuto: candidate.isAuto,
    isRelic: candidate.isRelic,
    team: candidate.team || null,
    sport: candidate.sport || null,
    checklistIdentityId: candidate.identityId,
    checklistFingerprintSha256: candidate.fingerprintSha256 || null,
  };
}

async function saveFailure(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  inventoryItemId: string;
  error: string;
  code: string;
  stage: string;
}) {
  if (!params.inventoryItemId) return;
  try {
    const { data } = await params.supabase
      .from("inventory_items")
      .select("metadata")
      .eq("id", params.inventoryItemId)
      .eq("store_id", params.storeId)
      .eq("status", "draft")
      .maybeSingle();
    const metadata = record(data?.metadata);
    const instaComp = record(metadata.instacomp);
    await params.supabase
      .from("inventory_items")
      .update({
        metadata: {
          ...metadata,
          instacomp: {
            ...instaComp,
            lastStatus: "failed",
            lastStage: params.stage,
            lastError: params.error,
            lastErrorCode: params.code,
            lastFailedAt: new Date().toISOString(),
          },
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.inventoryItemId)
      .eq("store_id", params.storeId)
      .eq("status", "draft");
  } catch {
    // Preserve and return the original failure.
  }
}

export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  let inventoryItemId = "";

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
    if (!isOwner) {
      return NextResponse.json(
        { success: false, error: "KINGMAKER exact scan is owner-only." },
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

    const { data: item, error: itemError } = await supabase
      .from("inventory_items")
      .select("id,seller_account_id,status,title,metadata")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .eq("status", "draft")
      .or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      .maybeSingle();
    if (itemError) throw itemError;
    if (!item) {
      return NextResponse.json(
        { success: false, error: "The selected KINGMAKER draft was not found." },
        { status: 404 },
      );
    }

    const metadata = record(item.metadata);
    const previousInstaComp = record(metadata.instacomp);
    const replaceManualIdentity =
      value("replaceManualIdentity") === true ||
      value("replaceManualIdentity") === "true";
    if (
      previousInstaComp.manualIdentityLocked === true &&
      !replaceManualIdentity
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "This seller-corrected identity is locked. Explicit replacement approval is required.",
          code: "MANUAL_IDENTITY_LOCKED",
          stage: "manual_lock",
        },
        { status: 409 },
      );
    }

    const { data: rows, error: imageError } = await supabase
      .from("inventory_images")
      .select("image_url,alt_text,sort_order,is_primary")
      .eq("inventory_item_id", inventoryItemId)
      .order("sort_order", { ascending: true });
    if (imageError) throw imageError;
    const pair = selectedPair((rows || []) as ImageRow[]);
    if (!pair.front?.url || !pair.back?.url || pair.front.url === pair.back.url) {
      return NextResponse.json(
        {
          success: false,
          error:
            "One distinct stored front and one distinct stored back are required.",
          code: "INVALID_STORED_PAIR",
          stage: "image_pair",
        },
        { status: 409 },
      );
    }

    let frontFile: File;
    let backFile: File;
    if (multipart) {
      const providedFront = value("frontImage");
      const providedBack = value("backImage");
      frontFile =
        providedFront instanceof File
          ? validateFile(providedFront, "front")
          : await downloadImage(pair.front.url, "front");
      backFile =
        providedBack instanceof File
          ? validateFile(providedBack, "back")
          : await downloadImage(pair.back.url, "back");
    } else {
      [frontFile, backFile] = await Promise.all([
        downloadImage(pair.front.url, "front"),
        downloadImage(pair.back.url, "back"),
      ]);
    }

    const normalizedSides = await normalizeInstaCompSideImages({
      frontImage: frontFile,
      backImage: backFile,
      // Fresh scanner uploads receive the whole-card frame once. Stored cards
      // are re-oriented without nesting another frame on every retry.
      addScanFrame: multipart,
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
          stage: "image_pair",
        },
        { status: 409 },
      );
    }

    const storedImages = await persistNormalizedInstaCompImagePair({
      supabase,
      storeId,
      inventoryItemId,
      title: item.title || "Card",
      frontFile: normalizedSides.frontFile,
      backFile: normalizedSides.backFile,
      orientation: normalizedSides.orientation,
      previousFrontImageUrl: pair.front.url,
      previousBackImageUrl: pair.back.url,
    });

    const serviceToken = getInstaCompServiceToken();
    if (!serviceToken) {
      throw new Error("The internal InstaComp service credential is missing.");
    }
    const scanForm = new FormData();
    scanForm.set("frontImage", normalizedSides.frontFile);
    scanForm.set("backImage", normalizedSides.backFile);
    scanForm.set("aiCouncilTier", "adaptive");
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
        supabase,
        storeId,
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
          stage: "identity_scan",
          imageOrientation: normalizedSides.orientation,
          normalizedImages: storedImages,
          imagesPreserved: true,
        },
        { status: scanResponse.status || 500 },
      );
    }

    const ai = record(scanPayload.ai);
    const currentTitle = String(item.title || "");
    const cardNumber =
      text(ai.cardNumber || ai.card_number, 80) ||
      titleCardNumber(currentTitle);
    const year = text(ai.year, 20) || titleYear(currentTitle);
    const manufacturer =
      text(ai.manufacturer || ai.brand, 120) ||
      titleManufacturer(currentTitle);
    const player =
      text(ai.player || ai.playerName, 180) ||
      titlePlayer(currentTitle, cardNumber);

    const broadDecision = await resolveInstaCompChecklistFirstFromRegistry({
      year,
      manufacturer,
      cardNumber,
      player,
      serialNumber: null,
      isAuto: null,
      isRelic: null,
      parallel: null,
      variation: null,
      ocrText: [
        currentTitle,
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
    const aiWithFeatures = {
      ...ai,
      parallelVisualFeatures: parallelDecision.features,
    };
    const resolvedAi = selected
      ? candidateAi(selected, aiWithFeatures)
      : aiWithFeatures;
    const nextTitle = selected
      ? canonicalTitle({ candidate: selected, ai, currentTitle })
      : reviewTitle({
          ai,
          currentTitle,
          year,
          manufacturer,
          cardNumber,
          player,
        });
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
              : null,
        exact_serial_number:
          parallelDecision.features.serialStampText || null,
        serial_run: parallelDecision.features.serialRun || null,
      },
      instacomp: {
        ...previousInstaComp,
        source: text(previousInstaComp.source, 120) || "kingmaker_exact_parallel",
        schema: "truely.instacompInventoryIdentity.v5",
        scanId: scanPayload.scanId || null,
        ai: resolvedAi,
        review: scanPayload.review || null,
        imageOrientation: normalizedSides.orientation,
        imageOrientationPersisted: true,
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
        parallelVisualFeatures: parallelDecision.features,
        identitySource: selected
          ? "checklist_plus_exact_visual_features"
          : "checklist_parallel_review_required",
        identityComplete,
        identityRuleApplied: selected
          ? "core_identity_then_color_pattern_serial_match"
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
          ? "Year, set, player, card number, color, pattern, and serial evidence resolved one checklist identity."
          : "The exact parallel is not proven. No Base or look-alike parallel was substituted.",
        lastStatus: identityComplete
          ? "identity_complete"
          : "review_required",
        lastStage: identityComplete ? "complete" : "parallel_review",
        lastError: null,
        lastErrorCode: null,
        scannedAt: checkedAt,
      },
    };

    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({
        title: nextTitle,
        metadata: nextMetadata,
        updated_at: checkedAt,
      })
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .eq("status", "draft");
    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      stage: identityComplete ? "complete" : "parallel_review",
      identityComplete,
      inventoryItemId,
      title: nextTitle,
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
    const failureMessage =
      error instanceof Error
        ? error.message
        : "Exact front-and-back identity scan failed.";
    await saveFailure({
      supabase,
      storeId,
      inventoryItemId,
      error: failureMessage,
      code: "INSTACOMP_EXACT_SCAN_FAILED",
      stage: "exact_pipeline",
    });
    return NextResponse.json(
      {
        success: false,
        error: failureMessage,
        code: "INSTACOMP_EXACT_SCAN_FAILED",
        stage: "exact_pipeline",
      },
      { status: 500 },
    );
  }
}
