from __future__ import annotations

from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    target = Path(path)
    source = target.read_text()
    if new in source:
        return
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    target.write_text(source.replace(old, new, 1))


def write(path: str, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


ORIENTATION = "src/lib/instacomp-image-orientation.ts"
INTAKE = "src/app/api/account/seller/instacomp-scan/intake/route.ts"
FRONT_BACK = "src/app/api/account/seller/inventory/instacomp-front-back/route.ts"
IMAGE_ROUTE = "src/app/api/admin/card-listing-images/route.ts"
AUDIT_PAGE = "src/app/kingmaker/instacomp-audit/page.tsx"

write(
    "src/lib/instacomp-wnba-parallel-policy.ts",
    r'''export type InstaCompWnbaParallelPolicyInput = {
  title: string;
  manufacturer?: string | null;
  setName?: string | null;
  parallel?: string | null;
  backHasStandalonePrizm: boolean | null;
};

const coloredPrizmPattern =
  /\b(?:silver|green|red|blue|gold|orange|purple|pink|black|white|ice|wave|cracked\s+ice|velocity)\s+prizm\b/i;

function clean(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function baseTitleWithoutUnsupportedPrizm(value: string) {
  return clean(value)
    .replace(
      /\b(?:base\s+)?(?:silver|green|red|blue|gold|orange|purple|pink|black|white|ice|wave|cracked\s+ice|velocity)\s+prizm\b/gi,
      "Base",
    )
    .replace(/\bbase\s+base\b/gi, "Base")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function applyWnbaBackDesignationPolicy(
  input: InstaCompWnbaParallelPolicyInput,
) {
  const context = clean(
    [input.title, input.manufacturer, input.setName, input.parallel]
      .filter(Boolean)
      .join(" "),
  );
  const wnbaPaniniOrSelect =
    /\bwnba\b/i.test(context) && /\b(?:panini|select|prizm)\b/i.test(context);
  const claimsColoredPrizm = coloredPrizmPattern.test(context);
  const forcedBase =
    input.backHasStandalonePrizm === false &&
    wnbaPaniniOrSelect &&
    claimsColoredPrizm;

  return {
    forcedBase,
    title: forcedBase
      ? baseTitleWithoutUnsupportedPrizm(input.title)
      : clean(input.title),
    parallel: forcedBase ? null : clean(input.parallel) || null,
    rule: forcedBase ? "wnba_back_missing_standalone_prizm_forced_base" : null,
  };
}
''',
)

write(
    "src/lib/instacomp-listing-image-storage.ts",
    r'''import "server-only";

import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "./supabase-server";

const IMAGE_BUCKET =
  process.env.INSTACOMP_DRAFT_IMAGE_BUCKET || "tcos-product-images";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

type Supabase = ReturnType<typeof createSupabaseServerClient>;

function safePart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "card";
}

function extension(file: File) {
  const type = file.type.toLowerCase();
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

async function ensureBucket(supabase: Supabase) {
  const { data, error } = await supabase.storage.getBucket(IMAGE_BUCKET);
  if (!error && data) return;
  const { error: createError } = await supabase.storage.createBucket(
    IMAGE_BUCKET,
    {
      public: true,
      fileSizeLimit: `${MAX_IMAGE_BYTES}`,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    },
  );
  if (
    createError &&
    !createError.message.toLowerCase().includes("already exists")
  ) {
    throw createError;
  }
}

async function upload(params: {
  supabase: Supabase;
  storeId: string;
  inventoryItemId: string;
  side: "front" | "back";
  file: File;
  source: string;
}) {
  if (!params.file.size || params.file.size > MAX_IMAGE_BYTES) {
    throw new Error(`${params.side} image is empty or larger than 20MB.`);
  }
  await ensureBucket(params.supabase);
  const path = [
    safePart(params.storeId),
    "instacomp-normalized",
    safePart(params.inventoryItemId),
    safePart(params.source),
    `${params.side}-${Date.now()}-${randomUUID()}.${extension(params.file)}`,
  ].join("/");
  const bytes = Buffer.from(await params.file.arrayBuffer());
  const { error } = await params.supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, bytes, {
      contentType: params.file.type || "image/jpeg",
      cacheControl: "31536000",
      upsert: false,
    });
  if (error) throw error;
  return params.supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data
    .publicUrl;
}

export async function persistInstaCompNormalizedPair(params: {
  supabase: Supabase;
  storeId: string;
  inventoryItemId: string;
  title: string;
  frontFile: File;
  backFile: File;
  source: string;
}) {
  const [frontImageUrl, backImageUrl] = await Promise.all([
    upload({
      supabase: params.supabase,
      storeId: params.storeId,
      inventoryItemId: params.inventoryItemId,
      source: params.source,
      side: "front",
      file: params.frontFile,
    }),
    upload({
      supabase: params.supabase,
      storeId: params.storeId,
      inventoryItemId: params.inventoryItemId,
      source: params.source,
      side: "back",
      file: params.backFile,
    }),
  ]);

  const { error: deleteError } = await params.supabase
    .from("inventory_images")
    .delete()
    .eq("inventory_item_id", params.inventoryItemId);
  if (deleteError) throw deleteError;

  const { error: insertError } = await params.supabase
    .from("inventory_images")
    .insert([
      {
        inventory_item_id: params.inventoryItemId,
        image_url: frontImageUrl,
        alt_text: `${params.title} front`,
        sort_order: 0,
        is_primary: true,
      },
      {
        inventory_item_id: params.inventoryItemId,
        image_url: backImageUrl,
        alt_text: `${params.title} back`,
        sort_order: 1,
        is_primary: false,
      },
    ]);
  if (insertError) throw insertError;

  return { frontImageUrl, backImageUrl };
}
''',
)

replace_once(
    ORIENTATION,
    '''  backConfidence: number;
  reason: string;
};''',
    '''  backConfidence: number;
  frontVisibleText: string[];
  backVisibleText: string[];
  backHasStandalonePrizm: boolean | null;
  reason: string;
};''',
    "orientation decision fields",
)

replace_once(
    ORIENTATION,
    '''function normalizedConfidence(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function parseJsonObject(value: string) {''',
    '''function normalizedConfidence(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function normalizedVisibleText(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => String(item || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 40)
    : [];
}

function parseJsonObject(value: string) {''',
    "orientation visible text helper",
)

replace_once(
    ORIENTATION,
    '''      frontConfidence: 0,
      backConfidence: 0,
      reason:
        "OPENAI_API_KEY is not configured; only embedded EXIF orientation can be normalized.",''',
    '''      frontConfidence: 0,
      backConfidence: 0,
      frontVisibleText: [],
      backVisibleText: [],
      backHasStandalonePrizm: null,
      reason:
        "OPENAI_API_KEY is not configured; only embedded EXIF orientation can be normalized.",''',
    "orientation not configured receipt",
)

replace_once(
    ORIENTATION,
    '''        "A horizontal card may correctly require 90 or 270 degrees. The back may require a different rotation from the front.",
        "Do not identify, price, or compare the card. Return JSON only.",''',
    '''        "A horizontal card may correctly require 90 or 270 degrees. The back may require a different rotation from the front.",
        "Transcribe short visible text from each side separately.",
        "For the BACK, report whether a separate standalone word PRIZM appears as a parallel designation near the card number or upper-left designation area.",
        "Ignore PRIZM when it appears only inside copyright, legal, product, or set-name text such as 2025 PANINI WNBA PRIZM BASKETBALL.",
        "Do not identify, price, or compare the card. Return JSON only.",''',
    "orientation prompt designation rule",
)

replace_once(
    ORIENTATION,
    '''                backConfidence: { type: "number" },
                reason: { type: "string" },''',
    '''                backConfidence: { type: "number" },
                frontVisibleText: {
                  type: "array",
                  items: { type: "string" },
                },
                backVisibleText: {
                  type: "array",
                  items: { type: "string" },
                },
                backHasStandalonePrizm: {
                  anyOf: [{ type: "boolean" }, { type: "null" }],
                },
                reason: { type: "string" },''',
    "orientation schema properties",
)

replace_once(
    ORIENTATION,
    '''                "frontConfidence",
                "backConfidence",
                "reason",''',
    '''                "frontConfidence",
                "backConfidence",
                "frontVisibleText",
                "backVisibleText",
                "backHasStandalonePrizm",
                "reason",''',
    "orientation schema required",
)

replace_once(
    ORIENTATION,
    '''    const baseReason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? sanitizeInstaCompProviderError(parsed.reason)
        : "No orientation reason returned.";
    return {
      status: "completed",''',
    '''    const baseReason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? sanitizeInstaCompProviderError(parsed.reason)
        : "No orientation reason returned.";
    const frontVisibleText = normalizedVisibleText(parsed.frontVisibleText);
    const backVisibleText = params.backDataUrl
      ? normalizedVisibleText(parsed.backVisibleText)
      : [];
    const backHasStandalonePrizm = params.backDataUrl
      ? typeof parsed.backHasStandalonePrizm === "boolean"
        ? parsed.backHasStandalonePrizm
        : null
      : null;
    return {
      status: "completed",''',
    "orientation parsed evidence",
)

replace_once(
    ORIENTATION,
    '''      frontConfidence,
      backConfidence,
      reason: lowConfidenceSides.length''',
    '''      frontConfidence,
      backConfidence,
      frontVisibleText,
      backVisibleText,
      backHasStandalonePrizm,
      reason: lowConfidenceSides.length''',
    "orientation completed receipt",
)

replace_once(
    ORIENTATION,
    '''      frontConfidence: 0,
      backConfidence: 0,
      reason: sanitizeInstaCompProviderError(error instanceof Error ? error.message : "Orientation detection failed."),''',
    '''      frontConfidence: 0,
      backConfidence: 0,
      frontVisibleText: [],
      backVisibleText: [],
      backHasStandalonePrizm: null,
      reason: sanitizeInstaCompProviderError(error instanceof Error ? error.message : "Orientation detection failed."),''',
    "orientation error receipt",
)

replace_once(
    INTAKE,
    '''import {
  analyzeWithInstaCompAiLocal,
  type InstaCompAiLocalScan,
} from "../../../../../../lib/instacomp-ai-local";
import { buildInstaCompChannelDraft } from "../../../../../../lib/instacomp-channel-draft";''',
    '''import {
  analyzeWithInstaCompAiLocal,
  type InstaCompAiLocalScan,
} from "../../../../../../lib/instacomp-ai-local";
import { normalizeInstaCompSideImages } from "../../../../../../lib/instacomp-image-orientation";
import { persistInstaCompNormalizedPair } from "../../../../../../lib/instacomp-listing-image-storage";
import { applyWnbaBackDesignationPolicy } from "../../../../../../lib/instacomp-wnba-parallel-policy";
import { buildInstaCompChannelDraft } from "../../../../../../lib/instacomp-channel-draft";''',
    "intake imports",
)

replace_once(
    INTAKE,
    '''    const scan = await analyzeWithInstaCompAiLocal({ front, back });
    const identity = lockedIdentity(scan);''',
    '''    const frontFile =
      front instanceof File
        ? front
        : new File([front], "front-upload.jpg", {
            type: front.type || "image/jpeg",
          });
    const backFile =
      back instanceof File
        ? back
        : new File([back], "back-upload.jpg", {
            type: back.type || "image/jpeg",
          });
    const normalizedSides = await normalizeInstaCompSideImages({
      frontImage: frontFile,
      backImage: backFile,
    });
    if (!normalizedSides.backFile) {
      throw new Error("Back-image normalization did not return a file.");
    }

    const scan = await analyzeWithInstaCompAiLocal({
      front: normalizedSides.frontFile,
      back: normalizedSides.backFile,
    });
    const identity = lockedIdentity(scan);''',
    "intake normalize before scan",
)

replace_once(
    INTAKE,
    '''    const fields = canonicalFields(identity);
    if (
      !fields.year ||''',
    '''    let fields = canonicalFields(identity);
    if (
      !fields.year ||''',
    "intake mutable canonical fields",
)

replace_once(
    INTAKE,
    '''    const imagePairSha256 = text(scan.image_pair_sha256, 128);''',
    '''    const wnbaPolicy = applyWnbaBackDesignationPolicy({
      title: titleFor(fields),
      manufacturer: fields.manufacturer,
      setName: fields.setName,
      parallel: fields.parallel,
      backHasStandalonePrizm:
        normalizedSides.orientation.backHasStandalonePrizm,
    });
    if (wnbaPolicy.forcedBase) {
      fields = { ...fields, parallel: null };
    }

    const imagePairSha256 = text(scan.image_pair_sha256, 128);''',
    "intake WNBA back designation",
)

replace_once(
    INTAKE,
    '''        hasBackImage: true,
        imageRequirement: "front_and_back_required_for_listing",''',
    '''        hasBackImage: true,
        imageRequirement: "front_and_back_required_for_listing",
        imageOrientation: normalizedSides.orientation,
        backDesignation: {
          standalonePrizm:
            normalizedSides.orientation.backHasStandalonePrizm,
          visibleText: normalizedSides.orientation.backVisibleText,
        },
        identityRuleApplied: wnbaPolicy.rule,''',
    "intake metadata orientation",
)

replace_once(
    INTAKE,
    '''    if (insertError) throw insertError;

    const requestId = `scan-${scan.scan_id}`;''',
    '''    if (insertError) throw insertError;

    let storedImages: {
      frontImageUrl: string;
      backImageUrl: string;
    };
    try {
      storedImages = await persistInstaCompNormalizedPair({
        supabase,
        storeId,
        inventoryItemId: inserted.id,
        title: inserted.title,
        frontFile: normalizedSides.frontFile,
        backFile: normalizedSides.backFile,
        source: "scanner-intake",
      });
    } catch (imageError) {
      await supabase.from("inventory_items").delete().eq("id", inserted.id);
      throw imageError;
    }

    const metadataWithImages = {
      ...metadata,
      instacomp: {
        ...metadata.instacomp,
        frontImageUrl: storedImages.frontImageUrl,
        backImageUrl: storedImages.backImageUrl,
      },
    };
    const { error: imageMetadataError } = await supabase
      .from("inventory_items")
      .update({
        metadata: metadataWithImages,
        updated_at: new Date().toISOString(),
      })
      .eq("id", inserted.id)
      .eq("store_id", storeId)
      .eq("seller_account_id", account.id);
    if (imageMetadataError) throw imageMetadataError;

    const requestId = `scan-${scan.scan_id}`;''',
    "intake persist normalized pair",
)

replace_once(
    FRONT_BACK,
    '''import { assertSafeInstaCompRemoteImageUrl } from "../../../../../../lib/instacomp-provider-safety";
import { getActiveStoreId } from "../../../../../../lib/stores";''',
    '''import { assertSafeInstaCompRemoteImageUrl } from "../../../../../../lib/instacomp-provider-safety";
import { normalizeInstaCompSideImages } from "../../../../../../lib/instacomp-image-orientation";
import { persistInstaCompNormalizedPair } from "../../../../../../lib/instacomp-listing-image-storage";
import { applyWnbaBackDesignationPolicy } from "../../../../../../lib/instacomp-wnba-parallel-policy";
import { getActiveStoreId } from "../../../../../../lib/stores";''',
    "front-back imports",
)

replace_once(
    FRONT_BACK,
    '''    const [frontSha256, backSha256] = await Promise.all([digest(frontFile), digest(backFile)]);''',
    '''    const normalizedSides = await normalizeInstaCompSideImages({
      frontImage: frontFile,
      backImage: backFile,
    });
    if (!normalizedSides.backFile) {
      throw new Error("Back-image normalization did not return a file.");
    }
    frontFile = normalizedSides.frontFile;
    backFile = normalizedSides.backFile;

    const storedImages = await persistInstaCompNormalizedPair({
      supabase,
      storeId,
      inventoryItemId,
      title: item.title || "Card",
      frontFile,
      backFile,
      source: "pending-front-back",
    });

    const [frontSha256, backSha256] = await Promise.all([digest(frontFile), digest(backFile)]);''',
    "front-back normalize and persist",
)

replace_once(
    FRONT_BACK,
    '''    const hasPrizmOnBack = /\bprizm\b/i.test(retainedBackEvidence);
    const forcedBaseCard = isWnbaPaniniOrSelect && claimsPrizmParallel && !hasPrizmOnBack;
    const nextTitle = forcedBaseCard ? forceWnbaBaseTitle(item.title) : item.title;''',
    '''    const hasPrizmOnBack = /\bprizm\b/i.test(retainedBackEvidence);
    const wnbaPolicy = applyWnbaBackDesignationPolicy({
      title: item.title || "",
      manufacturer: text(ai.brand),
      setName: text(ai.setName) || text(ai.set),
      parallel: text(ai.parallelName) || text(ai.parallel),
      backHasStandalonePrizm:
        normalizedSides.orientation.backHasStandalonePrizm,
    });
    const forcedBaseCard =
      wnbaPolicy.forcedBase ||
      (normalizedSides.orientation.backHasStandalonePrizm === null &&
        isWnbaPaniniOrSelect &&
        claimsPrizmParallel &&
        !hasPrizmOnBack);
    const nextTitle = forcedBaseCard
      ? forceWnbaBaseTitle(item.title)
      : item.title;''',
    "front-back WNBA policy",
)

replace_once(
    FRONT_BACK,
    '''        hasBackImage: true,
        frontSha256,
        backSha256,''',
    '''        hasBackImage: true,
        frontImageUrl: storedImages.frontImageUrl,
        backImageUrl: storedImages.backImageUrl,
        imageOrientation: normalizedSides.orientation,
        backDesignation: {
          standalonePrizm:
            normalizedSides.orientation.backHasStandalonePrizm,
          visibleText: normalizedSides.orientation.backVisibleText,
        },
        frontSha256,
        backSha256,''',
    "front-back metadata images",
)

replace_once(
    IMAGE_ROUTE,
    '''import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";''',
    '''import { getActiveStoreId } from "../../../../lib/stores";
import { detectInstaCompSideOrientations } from "../../../../lib/instacomp-image-orientation";
import { applyWnbaBackDesignationPolicy } from "../../../../lib/instacomp-wnba-parallel-policy";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";''',
    "image route imports",
)

replace_once(
    IMAGE_ROUTE,
    '''type ImageAction = "rotate" | "swap";''',
    '''type ImageAction = "rotate" | "swap" | "normalize";''',
    "image normalize action type",
)

replace_once(
    IMAGE_ROUTE,
    '''  const rotated = await sharp(bytes, { failOn: "error" })
    .rotate(params.degrees, { background: "#ffffff" })''',
    '''  const rotated = await sharp(bytes, { failOn: "error" })
    .autoOrient()
    .rotate(params.degrees, { background: "#ffffff" })''',
    "image autoOrient",
)

replace_once(
    IMAGE_ROUTE,
    '''async function replaceAssignedImages(params: {''',
    '''async function imageDataUrl(url: string, side: ImageSide) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`The ${side} image returned HTTP ${response.status}.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(`The ${side} image is empty or too large.`);
  }
  const type =
    response.headers.get("content-type")?.split(";")[0]?.trim() ||
    "image/jpeg";
  return `data:${type};base64,${bytes.toString("base64")}`;
}

async function replaceAssignedImages(params: {''',
    "image orientation data url",
)

replace_once(
    IMAGE_ROUTE,
    '''function nextMetadata(params: {
  metadata: UnknownRecord;
  action: ImageAction;
  side: ImageSide | null;
  degrees: number | null;
  front: string;
  back: string;
}) {''',
    '''function nextMetadata(params: {
  metadata: UnknownRecord;
  action: ImageAction;
  side: ImageSide | null;
  degrees: number | null;
  front: string;
  back: string;
  orientation?: {
    status: string;
    model: string | null;
    frontRotation: number;
    backRotation: number;
    frontConfidence: number;
    backConfidence: number;
    frontVisibleText: string[];
    backVisibleText: string[];
    backHasStandalonePrizm: boolean | null;
    reason: string;
  } | null;
}) {''',
    "image metadata orientation type",
)

replace_once(
    IMAGE_ROUTE,
    '''      updatedAt: now,
      history: [''',
    '''      updatedAt: now,
      autoOrientationPair:
        params.action === "normalize"
          ? `${params.front}|${params.back}`
          : null,
      autoOrientation:
        params.action === "normalize" ? params.orientation || null : null,
      history: [''',
    "image metadata orientation receipt",
)

replace_once(
    IMAGE_ROUTE,
    '''    if (action !== "rotate" && action !== "swap") {
      return Response.json(
        { success: false, error: "Use rotate or swap for image editing." },''',
    '''    if (
      action !== "rotate" &&
      action !== "swap" &&
      action !== "normalize"
    ) {
      return Response.json(
        {
          success: false,
          error: "Use rotate, swap, or normalize for image editing.",
        },''',
    "image action validation",
)

replace_once(
    IMAGE_ROUTE,
    '''    if (action === "swap" && !previous.back) {
      throw new Error("Both a front and back image are required before swapping.");
    }''',
    '''    if (
      (action === "swap" || action === "normalize") &&
      !previous.back
    ) {
      throw new Error(
        "Both a front and back image are required before this image action.",
      );
    }

    if (action === "normalize") {
      const previousEditing = record(
        record(card.inventory.metadata).imageEditing,
      );
      const currentPair = `${previous.front}|${previous.back}`;
      if (text(previousEditing.autoOrientationPair, 4_000) === currentPair) {
        return Response.json({
          success: true,
          changed: false,
          action,
          inventoryItemId,
          frontImageUrl: previous.front,
          backImageUrl: previous.back,
          message: "Stored front and back are already orientation-normalized.",
        });
      }
    }''',
    "image normalize no-op",
)

replace_once(
    IMAGE_ROUTE,
    '''    let front = previous.front;
    let back = previous.back;
    let rotatedSourceUrl = "";

    if (action === "swap") {
      front = previous.back;
      back = previous.front;
    } else {
      rotatedSourceUrl = side === "front" ? previous.front : previous.back;
      const rotatedUrl = await rotateImage({
        supabase,
        storeId,
        inventoryItemId,
        side,
        sourceUrl: rotatedSourceUrl,
        degrees,
      });
      if (side === "front") front = rotatedUrl;
      else back = rotatedUrl;
    }''',
    '''    let front = previous.front;
    let back = previous.back;
    let rotatedSourceUrl = "";
    let orientation: Awaited<
      ReturnType<typeof detectInstaCompSideOrientations>
    > | null = null;

    if (action === "swap") {
      front = previous.back;
      back = previous.front;
    } else if (action === "normalize") {
      const [frontDataUrl, backDataUrl] = await Promise.all([
        imageDataUrl(previous.front, "front"),
        imageDataUrl(previous.back, "back"),
      ]);
      orientation = await detectInstaCompSideOrientations({
        frontDataUrl,
        backDataUrl,
      });
      const [normalizedFront, normalizedBack] = await Promise.all([
        rotateImage({
          supabase,
          storeId,
          inventoryItemId,
          side: "front",
          sourceUrl: previous.front,
          degrees: orientation.frontRotation,
        }),
        rotateImage({
          supabase,
          storeId,
          inventoryItemId,
          side: "back",
          sourceUrl: previous.back,
          degrees: orientation.backRotation,
        }),
      ]);
      front = normalizedFront;
      back = normalizedBack;
    } else {
      rotatedSourceUrl = side === "front" ? previous.front : previous.back;
      const rotatedUrl = await rotateImage({
        supabase,
        storeId,
        inventoryItemId,
        side,
        sourceUrl: rotatedSourceUrl,
        degrees,
      });
      if (side === "front") front = rotatedUrl;
      else back = rotatedUrl;
    }''',
    "image normalize branch",
)

replace_once(
    IMAGE_ROUTE,
    '''      back,
    });
    const { error: metadataError } = await supabase
      .from("inventory_items")
      .update({ metadata, updated_at: new Date().toISOString() })''',
    '''      back,
      orientation,
    });
    const titlePolicy = applyWnbaBackDesignationPolicy({
      title: card.inventory.title,
      parallel: text(
        record(record(card.inventory.metadata).instacomp).parallel,
      ),
      backHasStandalonePrizm:
        orientation?.backHasStandalonePrizm ?? null,
    });
    const nextTitle = titlePolicy.forcedBase
      ? titlePolicy.title
      : card.inventory.title;
    const { error: metadataError } = await supabase
      .from("inventory_items")
      .update({
        title: nextTitle,
        metadata,
        updated_at: new Date().toISOString(),
      })''',
    "image metadata/title update",
)

replace_once(
    IMAGE_ROUTE,
    '''      action,
      inventoryItemId,
      frontImageUrl: front,''',
    '''      action,
      changed: true,
      inventoryItemId,
      frontImageUrl: front,''',
    "image changed receipt",
)

replace_once(
    IMAGE_ROUTE,
    '''      message:
        action === "swap"
          ? "Front and back images were swapped. InstaComp 2.0 was reset to pending."
          : `${side === "front" ? "Front" : "Back"} image rotated ${degrees > 0 ? "right" : "left"}. InstaComp 2.0 was reset to pending.`,''',
    '''      orientation,
      message:
        action === "swap"
          ? "Front and back images were swapped. InstaComp 2.0 was reset to pending."
          : action === "normalize"
            ? "Front and back were automatically oriented and saved as the permanent image pair."
            : `${side === "front" ? "Front" : "Back"} image rotated ${degrees > 0 ? "right" : "left"}. InstaComp 2.0 was reset to pending.`,''',
    "image normalize response",
)

replace_once(
    AUDIT_PAGE,
    '''import { useCallback, useEffect, useMemo, useState } from "react";''',
    '''import { useCallback, useEffect, useMemo, useRef, useState } from "react";''',
    "audit useRef import",
)

replace_once(
    AUDIT_PAGE,
    '''  const [pageError, setPageError] = useState("");

  const load = useCallback(async () => {''',
    '''  const [pageError, setPageError] = useState("");
  const autoNormalizedItems = useRef(new Set<string>());

  const load = useCallback(async () => {''',
    "audit auto normalization ref",
)

replace_once(
    AUDIT_PAGE,
    '  async function authorizedJson(\n    url: string,\n    body: Record<string, unknown>,\n  ) {',
    '  async function autoNormalizeItem(item: AuditItem) {\n    if (autoNormalizedItems.current.has(item.inventoryItemId)) return;\n    autoNormalizedItems.current.add(item.inventoryItemId);\n    try {\n      const response = await fetch("/api/admin/card-listing-images", {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        credentials: "same-origin",\n        body: JSON.stringify({\n          inventoryItemId: item.inventoryItemId,\n          action: "normalize",\n        }),\n      });\n      const data = (await response.json()) as Record<string, unknown>;\n      if (!response.ok || data.success !== true) {\n        throw new Error(\n          text(data.error) || "Automatic image orientation failed.",\n        );\n      }\n      if (data.changed === true) {\n        const nextFront = text(data.frontImageUrl);\n        const nextBack = text(data.backImageUrl);\n        setPayload((current) =>\n          current\n            ? {\n                ...current,\n                items: current.items.map((candidate) =>\n                  candidate.inventoryItemId === item.inventoryItemId\n                    ? {\n                        ...candidate,\n                        imageAudit: {\n                          ...candidate.imageAudit,\n                          frontImageUrl:\n                            nextFront || candidate.imageAudit.frontImageUrl,\n                          backImageUrl:\n                            nextBack || candidate.imageAudit.backImageUrl,\n                        },\n                      }\n                    : candidate,\n                ),\n              }\n            : current,\n        );\n        setAction(item.inventoryItemId, {\n          notice:\n            text(data.message) ||\n            "Front and back were automatically oriented and saved.",\n          error: "",\n        });\n      }\n    } catch (error) {\n      setAction(item.inventoryItemId, {\n        error:\n          error instanceof Error\n            ? error.message\n            : "Automatic image orientation failed.",\n        notice: "",\n      });\n    }\n  }\n\n  async function authorizedJson(\n    url: string,\n    body: Record<string, unknown>,\n  ) {',
    "audit lazy auto normalization function",
)

replace_once(
    AUDIT_PAGE,
    '''    if (locked) {
      setAction(item.inventoryItemId, {
        error: "Unlock the identity before changing its image evidence.",''',
    '''    if (locked && action === "swap") {
      setAction(item.inventoryItemId, {
        error: "Unlock the identity before swapping front and back.",''',
    "audit locked rotation",
)

replace_once(
    AUDIT_PAGE,
    '                            <img\n                              src={url}\n                              alt={`${form.title} ${side}`}\n                              className="max-h-[34rem] max-w-full object-contain"\n                            />',
    '                            <img\n                              src={url}\n                              alt={`${form.title} ${side}`}\n                              loading="lazy"\n                              onLoad={() => {\n                                if (side === "back") {\n                                  void autoNormalizeItem(item);\n                                }\n                              }}\n                              className="max-h-[34rem] max-w-full object-contain"\n                            />',
    "audit lazy image normalization trigger",
)

replace_once(
    AUDIT_PAGE,
    '''                        Rotate and swap save immediately. Lock the identity after the
                        images are correct.''',
    '''                        Front and back are automatically oriented and saved on load.
                        Manual rotation remains available even when identity is locked; swapping sides still requires unlock.''',
    "audit image instruction",
)

target = Path(AUDIT_PAGE)
source = target.read_text()
old_disabled = "                            disabled={locked || Boolean(action?.busy) || !url}"
new_disabled = "                            disabled={Boolean(action?.busy) || !url}"
if old_disabled in source:
    count = source.count(old_disabled)
    if count != 2:
        raise SystemExit(
            f"audit rotate buttons: expected two locked anchors, found {count}"
        )
    target.write_text(source.replace(old_disabled, new_disabled))
elif source.count(new_disabled) < 2:
    raise SystemExit("audit rotate buttons were not updated")

write(
    "scripts/check-instacomp-auto-orientation-base.mjs",
    r'''import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}
function requireText(source, text, message) {
  if (!source.includes(text)) throw new Error(message);
}

const orientation = read("src/lib/instacomp-image-orientation.ts");
const intake = read("src/app/api/account/seller/instacomp-scan/intake/route.ts");
const frontBack = read(
  "src/app/api/account/seller/inventory/instacomp-front-back/route.ts",
);
const imageRoute = read("src/app/api/admin/card-listing-images/route.ts");
const page = read("src/app/kingmaker/instacomp-audit/page.tsx");
const policy = read("src/lib/instacomp-wnba-parallel-policy.ts");

requireText(
  orientation,
  "backHasStandalonePrizm",
  "Orientation must return a standalone PRIZM designation receipt.",
);
requireText(
  orientation,
  "Ignore PRIZM when it appears only inside copyright, legal, product, or set-name text",
  "Legal set text must not count as a parallel designation.",
);
requireText(
  intake,
  "normalizeInstaCompSideImages",
  "Scanner intake must normalize before the Mac scan.",
);
requireText(
  intake,
  "persistInstaCompNormalizedPair",
  "Scanner intake must persist the normalized pair.",
);
requireText(
  frontBack,
  'source: "pending-front-back"',
  "Pending rescans must persist their normalized pair.",
);
requireText(
  frontBack,
  "normalizedSides.orientation.backHasStandalonePrizm",
  "Pending WNBA policy must use the dedicated back designation.",
);
requireText(
  imageRoute,
  'type ImageAction = "rotate" | "swap" | "normalize";',
  "Admin image route must support automatic normalization.",
);
requireText(
  imageRoute,
  ".autoOrient()",
  "Stored image transforms must honor EXIF orientation.",
);
requireText(
  page,
  "autoNormalizedItems",
  "KINGMAKER must automatically normalize stored pairs.",
);
if (
  page.includes(
    'disabled={locked || Boolean(action?.busy) || !url}',
  )
) {
  throw new Error("Locked identity must not disable pure image rotation.");
}
requireText(
  policy,
  "wnba_back_missing_standalone_prizm_forced_base",
  "WNBA back designation policy is missing.",
);

console.log("InstaComp automatic orientation and WNBA Base contract passed.");
''',
)

print("Applied automatic image orientation, permanent pair storage, and WNBA Base designation repair.")
