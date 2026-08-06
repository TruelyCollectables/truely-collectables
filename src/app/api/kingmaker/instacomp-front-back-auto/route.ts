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

function text(value: unknown) {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function booleanOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
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
      alt: text(row.alt_text),
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
    headers: { "User-Agent": "TCOS-InstaComp-AutoOrientation/1.0" },
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

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleWithChecklistParallel(
  title: string,
  candidates: InstaCompChecklistCandidate[],
  selected: InstaCompChecklistCandidate,
) {
  let next = title;
  const listed = Array.from(
    new Set(
      candidates
        .map((candidate) => String(candidate.parallel || "Base").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => right.length - left.length);
  for (const parallel of listed) {
    next = next.replace(new RegExp(`\\b${escapeRegex(parallel)}\\b`, "gi"), " ");
  }
  next = next
    .replace(
      /\b(?:base\s+)?(?:green|silver|red|blue|gold|orange|purple|pink|black|white|ice|wave|velocity|cracked\s+ice)(?:\s+prizm)?\b/gi,
      " ",
    )
    .replace(/\bbase\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parallel = selected.parallel || "Base";
  const rookieSuffix = /\sRC\s*$/i.test(next) ? " RC" : "";
  if (rookieSuffix) next = next.replace(/\sRC\s*$/i, "").trim();
  return `${next} ${parallel}${rookieSuffix}`.replace(/\s+/g, " ").trim();
}

function candidateAi(candidate: InstaCompChecklistCandidate, ai: JsonRecord) {
  const parallel = candidate.parallel || "Base";
  return {
    ...ai,
    year: candidate.year,
    manufacturer: candidate.manufacturer,
    brand: candidate.brand || candidate.manufacturer,
    setName: candidate.setName || candidate.product || null,
    cardNumber: candidate.cardNumber,
    player: candidate.player,
    parallel: normalized(parallel) === "base" ? null : parallel,
    parallelName: normalized(parallel) === "base" ? null : parallel,
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

export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
        { error: "KINGMAKER image and identity repair is owner-only." },
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
    const inventoryItemId = String(value("inventoryItemId") || "").trim();
    if (!inventoryItemId) {
      return NextResponse.json(
        { error: "Choose a card to scan." },
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
        { error: "The selected KINGMAKER draft was not found." },
        { status: 404 },
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
          error:
            "This corrected identity is locked. Explicit replacement approval is required.",
          code: "MANUAL_IDENTITY_LOCKED",
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
          error:
            "One distinct stored front and one distinct stored back are required.",
          code: "INVALID_STORED_PAIR",
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
        { error: "Front and back normalized to the same image bytes." },
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
    });

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
      return NextResponse.json(
        {
          error: scanPayload?.error || "Identity scan failed.",
          code: scanPayload?.code || `HTTP_${scanResponse.status}`,
          imageOrientation: normalizedSides.orientation,
          normalizedImages: storedImages,
        },
        { status: scanResponse.status || 500 },
      );
    }

    const ai = record(scanPayload.ai);
    const title = String(item.title || "");
    const broadDecision = await resolveInstaCompChecklistFirstFromRegistry({
      year: text(ai.year) || titleYear(title),
      manufacturer: text(ai.manufacturer || ai.brand),
      cardNumber: text(ai.cardNumber || ai.card_number) || titleCardNumber(title),
      player: text(ai.player || ai.playerName),
      serialNumber: text(ai.serialNumber || ai.printRun),
      isAuto: booleanOrNull(ai.isAuto),
      isRelic: booleanOrNull(ai.isRelic),
      parallel: null,
      variation: text(ai.variation),
      ocrText: [
        title,
        text(ai.notes),
        text(ai.frontText || ai.frontVisibleText),
        text(ai.backText || ai.backVisibleText || ai.backEvidence),
      ]
        .filter(Boolean)
        .join(" "),
    });

    const candidates = broadDecision.match
      ? [broadDecision.match]
      : broadDecision.candidates;
    const parallelDecision = await resolveChecklistParallelFromVision({
      frontDataUrl: normalizedSides.frontDataUrl,
      backDataUrl: normalizedSides.backDataUrl,
      candidates,
      aiParallel: text(ai.parallelName || ai.parallel),
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
          selected && !selectedIsBase ? selectedParallel : selected ? null : collectibleAsset.parallel_name || null,
      },
      instacomp: {
        ...previousInstaComp,
        schema: "truely.instacompInventoryIdentity.v3",
        scanId: scanPayload.scanId || null,
        ai: resolvedAi,
        review: scanPayload.review || null,
        imageOrientation: normalizedSides.orientation,
        imageOrientationPersisted: true,
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
          ? "checklist_constrained_parallel_no_base_default"
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
          ? "Checklist identity resolved. Pricing remains separate."
          : "Multiple checklist identities remain. Base was not assumed.",
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
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Automatic orientation and checklist identity scan failed.",
        code: "INSTACOMP_AUTO_SCAN_FAILED",
      },
      { status: 500 },
    );
  }
}
