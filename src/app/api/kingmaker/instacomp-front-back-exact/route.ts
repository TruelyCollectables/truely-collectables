import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../lib/account-auth";
import {
  analyzeWithInstaCompAiLocal,
  fetchInstaCompAiLocalScanImage,
  type InstaCompAiLocalScan,
} from "../../../../lib/instacomp-ai-local";
import type { InstaCompChecklistCandidate } from "../../../../lib/instacomp-checklist-first";
import { resolveInstaCompChecklistFirstFromRegistry } from "../../../../lib/instacomp-checklist-first-server";
import { resolveChecklistParallelFromVision } from "../../../../lib/instacomp-checklist-parallel-vision";
import {
  readInstaCompCoreVisualEvidence,
  type InstaCompCoreVisualEvidence,
} from "../../../../lib/instacomp-core-visual-evidence";
import { normalizeInstaCompSideImages } from "../../../../lib/instacomp-image-orientation";
import {
  persistNormalizedInstaCompImagePair,
  type InstaCompImageOrientationReceipt,
} from "../../../../lib/instacomp-normalized-image-storage";
import { assertSafeInstaCompRemoteImageUrl } from "../../../../lib/instacomp-provider-safety";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

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

type MacReceipt = {
  scanId: string | null;
  status: string | null;
  checklistOutcome: string | null;
  attempts: number;
  canonicalImagesRecovered: boolean;
  imageOrientation: InstaCompAiLocalScan["image_orientation"];
  error: string | null;
};

type MacArchiveResult = {
  receipt: MacReceipt;
  frontFile: File | null;
  backFile: File | null;
  orientation: InstaCompImageOrientationReceipt | null;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown, maximum = 2_000) {
  const cleaned = String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
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

function quarterTurn(value: unknown): 0 | 90 | 180 | 270 {
  const rotation = ((Math.round(Number(value) || 0) % 360) + 360) % 360;
  return rotation === 90 || rotation === 180 || rotation === 270
    ? rotation
    : 0;
}

function confidence(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
}

function evidence(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((entry) => text(entry, 120))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, 8)
    : [];
}

function completedMacOrientation(
  scan: InstaCompAiLocalScan,
  webOrientation: InstaCompImageOrientationReceipt,
): InstaCompImageOrientationReceipt {
  const receipt = scan.image_orientation || {};
  const source = text(receipt.source, 120) || "mac_local_orientation";
  const frontSource = text(receipt.front_source, 120) || source;
  const backSource = text(receipt.back_source, 120) || source;
  const frontFromWeb = frontSource === "web_openai_orientation";
  const backFromWeb = backSource === "web_openai_orientation";
  const frontConfidence = frontFromWeb
    ? confidence(webOrientation.frontConfidence)
    : confidence(receipt.front_confidence);
  const backConfidence = backFromWeb
    ? confidence(webOrientation.backConfidence)
    : confidence(receipt.back_confidence);
  const frontEvidenceText = frontFromWeb
    ? evidence(webOrientation.frontEvidenceText)
    : evidence(receipt.front_evidence);
  const backEvidenceText = backFromWeb
    ? evidence(webOrientation.backEvidenceText)
    : evidence(receipt.back_evidence);
  const scanCompleted = text(receipt.status, 80) === "completed";
  const completed =
    scanCompleted &&
    frontConfidence >= MINIMUM_MAC_ORIENTATION_CONFIDENCE &&
    backConfidence >= MINIMUM_MAC_ORIENTATION_CONFIDENCE &&
    frontEvidenceText.length > 0 &&
    backEvidenceText.length > 0;
  return {
    status: completed ? "completed" : "review_required",
    model: source,
    source,
    frontRotation: quarterTurn(receipt.front_rotation),
    backRotation: quarterTurn(receipt.back_rotation),
    frontConfidence,
    backConfidence,
    frontEvidenceText,
    backEvidenceText,
    backStandalonePrizm: null,
    backDesignationConfidence: 0,
    reason: completed
      ? "The Mac normalized and archived both card sides; the website fetched those canonical pixels and verified the stored pair."
      : "The Mac archive did not return decisive orientation evidence for both card sides, so this card is held outside Pending Listings.",
  };
}

const MINIMUM_MAC_ORIENTATION_CONFIDENCE = 0.55;

function trustedWebRotation(
  orientation: InstaCompImageOrientationReceipt,
  side: "front" | "back",
) {
  if (orientation.status !== "completed") return null;
  const sideConfidence =
    side === "front" ? orientation.frontConfidence : orientation.backConfidence;
  const sideEvidence =
    side === "front"
      ? orientation.frontEvidenceText
      : orientation.backEvidenceText;
  if (
    confidence(sideConfidence) < MINIMUM_MAC_ORIENTATION_CONFIDENCE ||
    evidence(sideEvidence).length === 0
  ) {
    return null;
  }
  return side === "front"
    ? quarterTurn(orientation.frontRotation)
    : quarterTurn(orientation.backRotation);
}

async function dataUrl(file: File) {
  const type = file.type || "image/jpeg";
  return `data:${type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
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
    // Cloudflare Workers supports follow/manual, but rejects the Fetch-standard
    // `error` mode at runtime. Manual still fails closed because every redirect
    // response is rejected before any bytes are accepted.
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "TCOS-InstaComp-FirstTimeIdentity/1.0" },
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`${side} image redirect was blocked.`);
  }
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

const PRODUCT_FAMILY_PATTERNS = [
  ["prizm", /\bprizm\b/i],
  ["select", /\bselect\b/i],
  ["optic", /\boptic\b/i],
  ["mosaic", /\bmosaic\b/i],
  ["donruss", /\bdonruss\b/i],
  ["chronicles", /\bchronicles\b/i],
  ["contenders", /\bcontenders\b/i],
  ["revolution", /\brevolution\b/i],
  ["origins", /\borigins\b/i],
  ["immaculate", /\bimmaculate\b/i],
  ["flawless", /\bflawless\b/i],
  ["national treasures", /\bnational\s+treasures\b/i],
  ["topps chrome", /\btopps\s+chrome\b/i],
  ["bowman chrome", /\bbowman\s+chrome\b/i],
  ["bowman", /\bbowman\b/i],
  ["upper deck", /\bupper\s+deck\b/i],
  ["o-pee-chee", /\bo[ -]?pee[ -]?chee\b/i],
  ["finest", /\bfinest\b/i],
  ["stadium club", /\bstadium\s+club\b/i],
] as const;

function productFamilies(value: unknown) {
  const source = String(value ?? "");
  return PRODUCT_FAMILY_PATTERNS.filter(([, pattern]) => pattern.test(source)).map(
    ([family]) => family,
  );
}

function filterCandidatesByProduct(
  candidates: InstaCompChecklistCandidate[],
  core: InstaCompCoreVisualEvidence,
) {
  const requestedFamilies = Array.from(
    new Set(productFamilies([core.product, core.setName].filter(Boolean).join(" "))),
  );
  if (!requestedFamilies.length) {
    return { candidates, requestedFamilies, filterApplied: false };
  }

  const filtered = candidates.filter((candidate) => {
    const candidateText = [
      candidate.product,
      candidate.setName,
      candidate.brand,
      candidate.manufacturer,
    ]
      .filter(Boolean)
      .join(" ");
    const candidateFamilies = productFamilies(candidateText);
    return requestedFamilies.every((family) => candidateFamilies.includes(family));
  });

  return {
    candidates: filtered.length ? filtered : candidates,
    requestedFamilies,
    filterApplied: filtered.length > 0,
  };
}

function cleanSetName(candidate: InstaCompChecklistCandidate) {
  const manufacturer = String(candidate.manufacturer || "").trim();
  const setName = String(candidate.setName || candidate.product || "").trim();
  if (!manufacturer || !setName) return setName || null;
  return setName.replace(new RegExp(`^${manufacturer}\\s+`, "i"), "").trim();
}

function canonicalTitle(params: {
  candidate: InstaCompChecklistCandidate;
  core: InstaCompCoreVisualEvidence;
}) {
  return [
    params.candidate.year || params.core.year,
    params.candidate.manufacturer || params.core.manufacturer,
    cleanSetName(params.candidate) || params.core.setName || params.core.product,
    params.candidate.cardNumber ? `#${params.candidate.cardNumber}` : null,
    params.candidate.player || params.core.player,
    params.candidate.parallel || "Base",
    params.core.rookie === true ? "RC" : null,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function reviewTitle(core: InstaCompCoreVisualEvidence, currentTitle: string) {
  if (currentTitle && !/^(?:InstaComp scan pending|Untitled card)$/i.test(currentTitle)) {
    return currentTitle;
  }
  return (
    [
      core.year,
      core.manufacturer,
      core.setName || core.product,
      core.cardNumber ? `#${core.cardNumber}` : null,
      core.player,
      "Identity Review Required",
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim() || "InstaComp card — identity review required"
  );
}

function candidateAi(
  candidate: InstaCompChecklistCandidate,
  core: InstaCompCoreVisualEvidence,
  parallelDecision: Awaited<ReturnType<typeof resolveChecklistParallelFromVision>>,
) {
  const exactParallel = candidate.parallel || "Base";
  const storedParallel = normalized(exactParallel) === "base" ? null : exactParallel;
  return {
    year: candidate.year || core.year,
    manufacturer: candidate.manufacturer || core.manufacturer,
    brand: candidate.brand || candidate.manufacturer || core.manufacturer,
    product: candidate.product || core.product,
    setName: candidate.setName || candidate.product || core.setName || core.product,
    cardNumber: candidate.cardNumber || core.cardNumber,
    card_number: candidate.cardNumber || core.cardNumber,
    player: candidate.player || core.player,
    playerName: candidate.player || core.player,
    parallel: storedParallel,
    parallelName: storedParallel,
    checklistParallel: exactParallel,
    variation: candidate.variation || null,
    serialNumber:
      parallelDecision.features.serialStampText ||
      (candidate.serialRun ? `/${candidate.serialRun}` : null),
    printRun: candidate.serialRun ? `/${candidate.serialRun}` : null,
    isRookie: core.rookie === true,
    isAuto: candidate.isAuto,
    isRelic: candidate.isRelic,
    team: candidate.team || core.team,
    sport: candidate.sport || core.sport,
    league: candidate.league || core.league,
    frontVisibleText: core.frontVisibleText,
    backVisibleText: core.backVisibleText,
    coreVisualConfidence: core.confidence,
    parallelVisualFeatures: parallelDecision.features,
    checklistIdentityId: candidate.identityId,
    checklistFingerprintSha256: candidate.fingerprintSha256 || null,
  };
}

async function archiveWithMacBestEffort(params: {
  frontFile: File;
  backFile: File;
  webOrientation: InstaCompImageOrientationReceipt;
}): Promise<MacArchiveResult> {
  let scan: InstaCompAiLocalScan | null = null;
  let attempts = 0;
  let lastError: unknown = null;
  try {
    const deadline = Date.now() + 225_000;
    for (const requestedTimeout of [150_000, 75_000]) {
      attempts += 1;
      try {
        scan = await analyzeWithInstaCompAiLocal({
          // Always send the untouched upload. The Mac applies the chosen
          // quarter-turn exactly once and archives the canonical pixels.
          front: params.frontFile,
          back: params.backFile,
          frontRotation: trustedWebRotation(params.webOrientation, "front"),
          backRotation: trustedWebRotation(params.webOrientation, "back"),
          timeoutMs: Math.max(
            5_000,
            Math.min(requestedTimeout, deadline - Date.now()),
          ),
        });
        break;
      } catch (error) {
        lastError = error;
        if (Date.now() >= deadline - 5_000) break;
      }
    }
    if (!scan) throw lastError || new Error("Mac archive did not respond.");
    const scanId = text(scan.scan_id, 100);
    if (!scanId) throw new Error("Mac archive returned no scan ID.");
    const [frontFile, backFile] = await Promise.all([
      fetchInstaCompAiLocalScanImage({ scanId, side: "front" }),
      fetchInstaCompAiLocalScanImage({ scanId, side: "back" }),
    ]);
    return {
      receipt: {
        scanId,
        status: text(scan.status, 100),
        checklistOutcome: text(scan.checklist?.outcome, 120),
        attempts,
        canonicalImagesRecovered: true,
        imageOrientation: scan.image_orientation || null,
        error: null,
      },
      frontFile,
      backFile,
      orientation: completedMacOrientation(scan, params.webOrientation),
    };
  } catch (error) {
    return {
      receipt: {
        scanId: text(scan?.scan_id, 100),
        status: text(scan?.status, 100),
        checklistOutcome: text(scan?.checklist?.outcome, 120),
        attempts,
        canonicalImagesRecovered: false,
        imageOrientation: scan?.image_orientation || null,
        error: text(
          error instanceof Error ? error.message : "Mac archive failed.",
          500,
        ),
      },
      frontFile: null,
      backFile: null,
      orientation: null,
    };
  }
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
    // Preserve the original error.
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
          success: true,
          identityComplete: previousInstaComp.identityComplete === true,
          title: item.title,
          stage: "manual_lock",
          locked: true,
          message:
            "Seller correction remains locked. Explicit replacement approval is required to rescan it.",
        },
        { headers: { "Cache-Control": "no-store" } },
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
      addScanFrame: multipart,
    });
    if (!normalizedSides.backFile || !normalizedSides.backDataUrl) {
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

    const macArchive = await archiveWithMacBestEffort({
      frontFile,
      backFile,
      webOrientation: normalizedSides.orientation,
    });
    const macReceipt = macArchive.receipt;
    if (
      !macArchive.frontFile ||
      !macArchive.backFile ||
      !macArchive.orientation ||
      macArchive.orientation.status !== "completed"
    ) {
      throw new Error(
        macReceipt.error ||
          macArchive.orientation?.reason ||
          "Automatic card orientation could not be verified. The card was held outside Pending Listings for an automatic retry.",
      );
    }

    const finalFrontFile = macArchive.frontFile;
    const finalBackFile = macArchive.backFile;
    const finalOrientation = macArchive.orientation;
    const [finalFrontSha256, finalBackSha256, finalFrontDataUrl, finalBackDataUrl] =
      await Promise.all([
        digest(finalFrontFile),
        digest(finalBackFile),
        dataUrl(finalFrontFile),
        dataUrl(finalBackFile),
      ]);
    if (finalFrontSha256 === finalBackSha256) {
      throw new Error("Mac archive returned identical front and back images.");
    }

    const core = await readInstaCompCoreVisualEvidence({
      frontDataUrl: finalFrontDataUrl,
      backDataUrl: finalBackDataUrl,
    });
    const coreMissing = [
      ["year", core.year],
      ["manufacturer", core.manufacturer],
      ["player", core.player],
      ["card_number", core.cardNumber],
    ]
      .filter(([, fieldValue]) => !fieldValue)
      .map(([field]) => field);

    const broadDecision = coreMissing.length
      ? {
          status: "input_incomplete" as const,
          aiRequired: true,
          match: null,
          candidates: [] as InstaCompChecklistCandidate[],
          reasons: coreMissing.map((field) => `missing_${field}`),
        }
      : await resolveInstaCompChecklistFirstFromRegistry({
          year: core.year,
          manufacturer: core.manufacturer,
          cardNumber: core.cardNumber,
          player: core.player,
          serialNumber: null,
          isAuto: null,
          isRelic: null,
          parallel: null,
          variation: null,
          ocrText: [
            core.product,
            core.setName,
            ...core.frontVisibleText,
            ...core.backVisibleText,
          ]
            .filter(Boolean)
            .join(" ")
            .slice(0, 12_000),
        });

    const rawCandidates = broadDecision.match
      ? [broadDecision.match]
      : broadDecision.candidates;
    const productFilter = filterCandidatesByProduct(rawCandidates, core);
    const candidates = productFilter.candidates;
    const parallelDecision = await resolveChecklistParallelFromVision({
      frontDataUrl: finalFrontDataUrl,
      backDataUrl: finalBackDataUrl,
      candidates,
    });
    const selected = candidates.find(
      (candidate) =>
        candidate.identityId === parallelDecision.selectedIdentityId,
    );
    const identityComplete = Boolean(selected);
    const resolvedAi = selected
      ? candidateAi(selected, core, parallelDecision)
      : {
          year: core.year,
          manufacturer: core.manufacturer,
          brand: core.manufacturer,
          product: core.product,
          setName: core.setName || core.product,
          player: core.player,
          cardNumber: core.cardNumber,
          team: core.team,
          sport: core.sport,
          league: core.league,
          isRookie: core.rookie === true,
          frontVisibleText: core.frontVisibleText,
          backVisibleText: core.backVisibleText,
          coreVisualConfidence: core.confidence,
          parallelVisualFeatures: parallelDecision.features,
        };

    const storedImages = await persistNormalizedInstaCompImagePair({
      supabase,
      storeId,
      inventoryItemId,
      title: item.title || "Card",
      frontFile: finalFrontFile,
      backFile: finalBackFile,
      orientation: finalOrientation,
      previousFrontImageUrl: pair.front.url,
      previousBackImageUrl: pair.back.url,
    });

    const checkedAt = new Date().toISOString();
    const collectibleAsset = record(metadata.collectible_asset);
    const selectedParallel = selected?.parallel || null;
    const selectedIsBase = normalized(selectedParallel) === "base";
    const nextTitle = selected
      ? canonicalTitle({ candidate: selected, core })
      : reviewTitle(core, String(item.title || ""));

    const nextMetadata = {
      ...metadata,
      collectible_asset: {
        ...collectibleAsset,
        parallel_name:
          selected && !selectedIsBase ? selectedParallel : null,
        exact_serial_number:
          parallelDecision.features.serialStampText || null,
        serial_run: parallelDecision.features.serialRun || null,
        rookie: core.rookie === true,
      },
      instacomp: {
        ...previousInstaComp,
        source:
          text(previousInstaComp.source, 120) ||
          "kingmaker_first_time_visual_checklist",
        schema: "truely.instacompInventoryIdentity.v6",
        scanId: macReceipt.scanId,
        macReceipt,
        ai: resolvedAi,
        coreVisualEvidence: core,
        imageOrientation: finalOrientation,
        imageOrientationNormalizedAt: checkedAt,
        imageOrientationPersisted: finalOrientation.status === "completed",
        imagePersistenceVerified: storedImages.verified === true,
        frontImageUrl: storedImages.frontImageUrl,
        backImageUrl: storedImages.backImageUrl,
        frontSha256: finalFrontSha256,
        backSha256: finalBackSha256,
        checklistDecision: {
          status: broadDecision.status,
          reasons: broadDecision.reasons,
          candidateCount: candidates.length,
          candidateIdentityIds: candidates.map(
            (candidate) => candidate.identityId,
          ),
          productFamilies: productFilter.requestedFamilies,
          productFilterApplied: productFilter.filterApplied,
        },
        parallelDecision,
        parallelVisualFeatures: parallelDecision.features,
        identitySource: selected
          ? "first_time_visual_core_plus_checklist_plus_surface"
          : "first_time_visual_review_required",
        identityComplete,
        identityRuleApplied: selected
          ? "year_product_player_card_then_color_pattern_serial"
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
          ? "One exact checklist identity survived core, product, color, pattern, and serial checks."
          : "The card was preserved, but one exact checklist identity did not survive every evidence gate.",
        lastStatus: identityComplete
          ? "identity_complete"
          : "review_required",
        lastStage: identityComplete
          ? "complete"
          : coreMissing.length
            ? "core_identity"
            : candidates.length
              ? "parallel_review"
              : "checklist_lookup",
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

    return NextResponse.json(
      {
        success: true,
        stage: identityComplete
          ? "complete"
          : coreMissing.length
            ? "core_identity"
            : candidates.length
              ? "parallel_review"
              : "checklist_lookup",
        identityComplete,
        title: nextTitle,
        ai: resolvedAi,
        coreVisualEvidence: core,
        checklistDecision: {
          ...broadDecision,
          candidates,
          productFamilies: productFilter.requestedFamilies,
          productFilterApplied: productFilter.filterApplied,
        },
        parallelDecision,
        macReceipt,
        imageOrientation: finalOrientation,
        normalizedImages: storedImages,
        pricingStatus: identityComplete
          ? "identity_complete_pricing_pending"
          : "blocked_identity_review_required",
        nothingPublished: true,
      },
      {
        status: identityComplete ? 200 : 202,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    const failure =
      error instanceof Error
        ? error.message
        : "First-time visual checklist scan failed.";
    await saveFailure({
      supabase,
      storeId,
      inventoryItemId,
      error: failure,
      code: "INSTACOMP_FIRST_TIME_SCAN_FAILED",
      stage: "automatic_pipeline",
    });
    return NextResponse.json(
      {
        success: false,
        error: failure,
        code: "INSTACOMP_FIRST_TIME_SCAN_FAILED",
        stage: "automatic_pipeline",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
