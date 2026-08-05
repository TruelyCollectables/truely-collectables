import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import { assertSafeInstaCompRemoteImageUrl } from "../../../../../../lib/instacomp-provider-safety";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";
import { POST as runInstaCompScan } from "../../../../instacomp/scan/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type ImageRow = {
  image_url: string | null;
  alt_text: string | null;
  sort_order: number | null;
  is_primary: boolean | null;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function bool(value: unknown) {
  return value === true || value === "true" || value === "1";
}

function normalizedPrintRun(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(/(?:\d+\s*)?\/\s*(\d{1,6})\b/);
  return match ? `/${Number(match[1])}` : null;
}

function evidenceText(value: unknown) {
  if (typeof value === "string") return value;
  if (!value) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function backEvidence(ai: Record<string, unknown>) {
  return [
    ai.backText,
    ai.back_text,
    ai.backOcr,
    ai.back_ocr,
    ai.backEvidence,
    ai.back_evidence,
    ai.backVisibleText,
    ai.back_visible_text,
  ]
    .map(evidenceText)
    .filter(Boolean)
    .join(" ")
    .trim();
}

function forceWnbaBaseTitle(value: unknown) {
  const raw = typeof value === "string" ? value : "";
  return raw
    .replace(
      /\b(?:base\s+)?(?:green|silver|red|blue|gold|orange|purple|pink|black|white|ice|wave|cracked\s+ice)\s+prizm\b/gi,
      "Base",
    )
    .replace(/\bbase\s+base\b/gi, "Base")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function pair(rows: ImageRow[]) {
  const images = rows
    .map((row) => ({
      url: text(row.image_url),
      alt: text(row.alt_text),
      order: Number(row.sort_order || 0),
      primary: row.is_primary === true,
    }))
    .filter((row): row is { url: string; alt: string | null; order: number; primary: boolean } => Boolean(row.url))
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
    images.find((image) => /\bback\b/i.test(image.alt || "") && image.url !== front?.url) ||
    images.find((image) => !image.primary && image.url !== front?.url) ||
    images.find((image) => image.url !== front?.url) ||
    null;

  return { front, back, count: images.length };
}

function validateFile(file: File, side: "front" | "back") {
  if (!file.size || file.size > MAX_IMAGE_BYTES) {
    throw new Error(`${side} image is empty or larger than 12MB.`);
  }
  const type = file.type.split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error(`${side} image is not a JPEG, PNG, or WebP file.`);
  }
  return file;
}

async function downloadStoredImage(url: string, side: "front" | "back") {
  const safeUrl = assertSafeInstaCompRemoteImageUrl(url);
  const response = await fetch(safeUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(25_000),
    headers: { "User-Agent": "TCOS-InstaComp-FrontBack/2.0" },
  });
  if (!response.ok) throw new Error(`${side} image returned HTTP ${response.status}.`);
  const bytes = await response.arrayBuffer();
  const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
  const extension = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  return validateFile(new File([bytes], `${side}.${extension}`, { type }), side);
}

async function digest(file: File) {
  return createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
}

export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  let inventoryItemId = "";
  let originalMetadata: Record<string, unknown> = {};

  async function saveFailure(errorMessage: string, code: string | null, stage: string) {
    if (!inventoryItemId) return;
    const instaComp = record(originalMetadata.instacomp);
    await supabase
      .from("inventory_items")
      .update({
        metadata: {
          ...originalMetadata,
          instacomp: {
            ...instaComp,
            lastStatus: "failed",
            lastStage: stage,
            lastError: errorMessage,
            lastErrorCode: code,
            lastFailedAt: new Date().toISOString(),
          },
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .eq("status", "draft");
  }

  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return NextResponse.json({ error: "Unauthorized", stage: "authentication" }, { status: 401 });
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });

    const multipart = request.headers.get("content-type")?.includes("multipart/form-data") === true;
    const body = multipart ? await request.formData() : await request.json().catch(() => ({}));
    const value = (key: string) => multipart ? body.get(key) : body?.[key];
    inventoryItemId = String(value("inventoryItemId") || "").trim();
    const replaceManualIdentity = bool(value("replaceManualIdentity"));
    if (!inventoryItemId) {
      return NextResponse.json({ error: "Choose a pending card to scan.", stage: "request" }, { status: 400 });
    }

    const isOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    let itemQuery = supabase
      .from("inventory_items")
      .select("id,seller_account_id,status,title,metadata")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .eq("status", "draft");
    itemQuery = isOwner
      ? itemQuery.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : itemQuery.eq("seller_account_id", account.id);
    const { data: item, error: itemError } = await itemQuery.maybeSingle();
    if (itemError) throw itemError;
    if (!item) return NextResponse.json({ error: "Pending card was not found.", stage: "load_card" }, { status: 404 });

    originalMetadata = record(item.metadata);
    const currentInstaComp = record(originalMetadata.instacomp);
    if (currentInstaComp.manualIdentityLocked === true && !replaceManualIdentity) {
      return NextResponse.json(
        {
          error: "This seller-corrected identity is locked. Choose Replace Manual Identity with AI to overwrite it.",
          code: "MANUAL_IDENTITY_LOCKED",
          stage: "identity_lock",
          identityComplete: true,
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

    const selected = pair((rows || []) as ImageRow[]);
    if (!selected.front?.url || !selected.back?.url || selected.front.url === selected.back.url) {
      const error = "InstaComp blocked: one distinct stored front and one distinct stored back are required.";
      await saveFailure(error, "INVALID_STORED_PAIR", "validate_images");
      return NextResponse.json({ error, code: "INVALID_STORED_PAIR", stage: "validate_images" }, { status: 409 });
    }

    let frontFile: File;
    let backFile: File;
    if (multipart) {
      const providedFront = value("frontImage");
      const providedBack = value("backImage");
      if (!(providedFront instanceof File) || !(providedBack instanceof File)) {
        const error = "The rotated front and back files were not included in the card request.";
        await saveFailure(error, "MISSING_SCAN_FILES", "prepare_images");
        return NextResponse.json({ error, code: "MISSING_SCAN_FILES", stage: "prepare_images" }, { status: 400 });
      }
      frontFile = validateFile(providedFront, "front");
      backFile = validateFile(providedBack, "back");
    } else {
      [frontFile, backFile] = await Promise.all([
        downloadStoredImage(selected.front.url, "front"),
        downloadStoredImage(selected.back.url, "back"),
      ]);
    }

    const [frontSha256, backSha256] = await Promise.all([digest(frontFile), digest(backFile)]);
    if (frontSha256 === backSha256) {
      const error = "InstaComp blocked: front and back contain the same image bytes.";
      await saveFailure(error, "DUPLICATE_IMAGE_BYTES", "validate_images");
      return NextResponse.json({ error, code: "DUPLICATE_IMAGE_BYTES", stage: "validate_images" }, { status: 409 });
    }

    const formData = new FormData();
    formData.set("frontImage", frontFile);
    formData.set("backImage", backFile);
    formData.set("aiCouncilTier", String(value("aiCouncilTier") || "adaptive"));
    const authorization = request.headers.get("authorization") || "";
    const scanRequest = new NextRequest("http://localhost/api/instacomp/scan", {
      method: "POST",
      headers: authorization ? { authorization } : undefined,
      body: formData,
    });
    const scanResponse = await runInstaCompScan(scanRequest);
    const scanPayload = await scanResponse.json().catch(() => ({}));
    if (!scanResponse.ok || scanPayload?.ok !== true || !scanPayload?.ai) {
      const error = scanPayload?.error || "Front-and-back identity scan failed.";
      const code = scanPayload?.code || `HTTP_${scanResponse.status || 500}`;
      await saveFailure(error, code, "identity_scan");
      return NextResponse.json(
        { error, code, stage: "identity_scan", identityComplete: false },
        { status: scanResponse.status || 500 },
      );
    }

    const collectibleAsset = record(originalMetadata.collectible_asset);
    const ai = record(scanPayload.ai);
    const run =
      normalizedPrintRun(ai.serialNumber) ||
      normalizedPrintRun(ai.printRun) ||
      normalizedPrintRun(collectibleAsset.exact_serial_number) ||
      normalizedPrintRun(collectibleAsset.print_run);
    const retainedBackEvidence = backEvidence(ai);
    const candidateText = `${item.title || ""} ${text(ai.brand) || ""} ${text(ai.setName) || ""} ${text(ai.set) || ""} ${text(ai.parallel) || ""} ${text(ai.parallelName) || ""}`;
    const isWnbaPaniniOrSelect =
      /\bwnba\b/i.test(candidateText) && /\b(?:panini|select)\b/i.test(candidateText);
    const claimsPrizmParallel = /\b(?:green|silver|red|blue|gold|orange|purple|pink|black|white|ice|wave|cracked\s+ice)\s+prizm\b/i.test(candidateText);
    const hasPrizmOnBack = /\bprizm\b/i.test(retainedBackEvidence);
    const forcedBaseCard = isWnbaPaniniOrSelect && claimsPrizmParallel && !hasPrizmOnBack;
    const nextTitle = forcedBaseCard ? forceWnbaBaseTitle(item.title) : item.title;
    const checkedAt = new Date().toISOString();

    const nextMetadata = {
      ...originalMetadata,
      collectible_asset: {
        ...collectibleAsset,
        exact_serial_number: run,
        print_run: run,
        parallel_name: forcedBaseCard ? null : (ai.parallelName || ai.parallel || collectibleAsset.parallel_name || null),
      },
      instacomp: {
        ...currentInstaComp,
        schema: "truely.instacompInventoryIdentity.v2",
        scanId: scanPayload.scanId || null,
        ai: {
          ...ai,
          serialNumber: run,
          printRun: run,
          parallel: forcedBaseCard ? null : ai.parallel,
          parallelName: forcedBaseCard ? null : ai.parallelName,
          backEvidenceText: retainedBackEvidence || null,
        },
        review: scanPayload.review || null,
        identitySource: "fresh_front_back_scan",
        identityComplete: true,
        identityRuleApplied: forcedBaseCard ? "wnba_no_prizm_on_back_forced_base" : null,
        hasBackImage: true,
        frontSha256,
        backSha256,
        humanVerified: false,
        trustedForIdentity: false,
        manualIdentityEdit: false,
        manualIdentityLocked: false,
        identityRefreshRequired: false,
        pricingStatus: "identity_complete_pricing_pending",
        pricingReason: "Identity saved successfully. Live pricing is separate and cannot fail card identity.",
        lastStatus: "identity_complete",
        lastStage: "complete",
        lastError: null,
        lastErrorCode: null,
        scannedAt: checkedAt,
      },
    };

    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ title: nextTitle, metadata: nextMetadata, updated_at: checkedAt })
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .eq("status", "draft");
    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      stage: "complete",
      identityComplete: true,
      pricingStatus: "identity_complete_pricing_pending",
      scanId: scanPayload.scanId || null,
      ai: nextMetadata.instacomp.ai,
      review: scanPayload.review || null,
      frontBackContract: {
        enforced: true,
        frontImageUrl: selected.front.url,
        backImageUrl: selected.back.url,
        frontSha256,
        backSha256,
        storedImageCount: selected.count,
      },
      identityRules: {
        printRun: run,
        prizmBackEvidenceRequired: true,
        prizmBackEvidenceFound: hasPrizmOnBack,
        forcedBaseCard,
        setNamePreserved: true,
      },
      nothingPublished: true,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Front/back identity scan failed.";
    await saveFailure(errorMessage, "UNEXPECTED_SCAN_ERROR", "server");
    return NextResponse.json(
      { error: errorMessage, code: "UNEXPECTED_SCAN_ERROR", stage: "server", identityComplete: false },
      { status: 500 },
    );
  }
}
