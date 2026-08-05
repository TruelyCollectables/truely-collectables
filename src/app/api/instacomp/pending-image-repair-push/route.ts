import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  InstaCompJobServerError,
  isValidInstaCompServiceRequest,
  requireInstaCompJobSupabase,
  requireUuid,
} from "../../../../lib/instacomp-job-server";
import { getActiveStoreId } from "../../../../lib/stores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const IMAGE_BUCKET = "instacomp-listing-images";
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type JsonRecord = Record<string, unknown>;

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function constantTimeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
  );
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function pairHash(frontSha256: string, backSha256: string) {
  return sha256(`front:${frontSha256}|back:${backSha256}`);
}

function requireServiceRequest(request: NextRequest) {
  requireInstaCompJobSupabase();
  if (!isValidInstaCompServiceRequest(request)) {
    throw new InstaCompJobServerError(
      "Valid InstaComp service authentication is required.",
      401,
      "INSTACOMP_REPAIR_UNAUTHORIZED",
    );
  }
}

async function ensureBucket() {
  const supabase = requireInstaCompJobSupabase();
  const { data } = await supabase.storage.getBucket(IMAGE_BUCKET);
  if (data) return;
  const { error } = await supabase.storage.createBucket(IMAGE_BUCKET, {
    public: true,
    fileSizeLimit: MAX_IMAGE_BYTES,
    allowedMimeTypes: Array.from(ALLOWED_TYPES),
  });
  if (error && !/already exists|duplicate/i.test(error.message || "")) {
    throw error;
  }
}

function extension(file: File) {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

async function uploadImage(params: {
  itemId: string;
  scanId: string;
  side: "front" | "back";
  file: File;
  hash: string;
}) {
  const supabase = requireInstaCompJobSupabase();
  const path = [
    "recovered",
    params.itemId,
    `${params.scanId}-${params.hash}-${params.side}.${extension(params.file)}`,
  ].join("/");
  const bytes = Buffer.from(await params.file.arrayBuffer());
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, bytes, {
    contentType: params.file.type,
    cacheControl: "31536000",
    upsert: true,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  if (!data.publicUrl) throw new Error(`Could not create ${params.side} image URL.`);
  return data.publicUrl;
}

async function ensureProduct(params: {
  row: any;
  frontUrl: string;
  now: string;
}) {
  const supabase = requireInstaCompJobSupabase();
  const storeId = getActiveStoreId();
  if (params.row.legacy_product_id) {
    const { data, error } = await supabase
      .from("products")
      .update({ image_url: params.frontUrl, last_seen_at: params.now })
      .eq("id", params.row.legacy_product_id)
      .eq("store_id", storeId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return Number(data.id);
  }

  if (params.row.sku) {
    const { data: matches, error } = await supabase
      .from("products")
      .select("id,title")
      .eq("store_id", storeId)
      .eq("sku", params.row.sku)
      .limit(2);
    if (error) throw error;
    if ((matches || []).length > 1) {
      throw new Error(`Multiple products already use SKU ${params.row.sku}.`);
    }
    if (matches?.[0]) {
      const candidateTitle = String(matches[0].title || "").trim().toLowerCase();
      const itemTitle = String(params.row.title || "").trim().toLowerCase();
      if (candidateTitle !== itemTitle) {
        throw new Error(`SKU ${params.row.sku} belongs to another product.`);
      }
      const { error: updateError } = await supabase
        .from("products")
        .update({ image_url: params.frontUrl, last_seen_at: params.now })
        .eq("id", matches[0].id)
        .eq("store_id", storeId);
      if (updateError) throw updateError;
      return Number(matches[0].id);
    }
  }

  const metadata = recordValue(params.row.metadata);
  const instaComp = recordValue(metadata.instacomp);
  const ai = recordValue(instaComp.ai);
  const { data: product, error } = await supabase
    .from("products")
    .insert({
      store_id: storeId,
      seller_account_id: params.row.seller_account_id || null,
      sku: params.row.sku || null,
      title: params.row.title || "Untitled item",
      description: params.row.description || "",
      player: textValue(ai.player) || textValue(ai.playerName),
      sport: textValue(ai.sport),
      price: Number(params.row.price || 0),
      quantity: Math.max(0, Number(params.row.quantity || 0)),
      image_url: params.frontUrl,
      ebay_item_id: null,
      last_seen_at: params.now,
    })
    .select("id")
    .single();
  if (error) throw error;
  return Number(product.id);
}

function errorResponse(error: unknown) {
  const status = error instanceof InstaCompJobServerError ? error.status : 500;
  return NextResponse.json(
    {
      ok: false,
      error: error instanceof Error ? error.message : "Pending image repair failed.",
    },
    { status },
  );
}

export async function GET(request: NextRequest) {
  try {
    requireServiceRequest(request);
    const supabase = requireInstaCompJobSupabase();
    const storeId = getActiveStoreId();
    const { data, error } = await supabase
      .from("inventory_items")
      .select("id,title,metadata,created_at")
      .eq("store_id", storeId)
      .eq("status", "draft")
      .order("created_at", { ascending: true });
    if (error) throw error;

    const items = (data || [])
      .map((row: any) => {
        const metadata = recordValue(row.metadata);
        const instaComp = recordValue(metadata.instacomp);
        return {
          inventoryItemId: row.id,
          title: row.title || "Untitled item",
          scanId: textValue(instaComp.scanId),
          hasBackImage: instaComp.hasBackImage === true,
        };
      })
      .filter((row) => row.scanId && !row.hasBackImage);

    return NextResponse.json({ ok: true, items, count: items.length });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireServiceRequest(request);
    const form = await request.formData();
    const itemId = requireUuid(form.get("inventoryItemId"), "inventoryItemId");
    const scanId = String(form.get("scanId") || "").trim();
    const expectedFront = String(form.get("frontSha256") || "").trim().toLowerCase();
    const expectedBack = String(form.get("backSha256") || "").trim().toLowerCase();
    const expectedPair = String(form.get("imagePairSha256") || "").trim().toLowerCase();
    const front = form.get("frontImage");
    const back = form.get("backImage");

    if (!scanId || scanId.length > 100) throw new Error("Valid scanId is required.");
    if (!(front instanceof File) || !(back instanceof File)) {
      throw new Error("Both original front and back images are required.");
    }
    for (const [side, file] of [["front", front], ["back", back]] as const) {
      if (!ALLOWED_TYPES.has(file.type)) throw new Error(`${side} image type is invalid.`);
      if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
        throw new Error(`${side} image is empty or larger than 12MB.`);
      }
    }

    const frontBytes = Buffer.from(await front.arrayBuffer());
    const backBytes = Buffer.from(await back.arrayBuffer());
    const actualFront = sha256(frontBytes);
    const actualBack = sha256(backBytes);
    const actualPair = pairHash(actualFront, actualBack);
    if (!constantTimeEqual(actualFront, expectedFront)) {
      throw new Error("Front image hash did not match the Mac scan receipt.");
    }
    if (!constantTimeEqual(actualBack, expectedBack)) {
      throw new Error("Back image hash did not match the Mac scan receipt.");
    }
    if (!constantTimeEqual(actualPair, expectedPair)) {
      throw new Error("Front/back pair hash did not match the Mac scan receipt.");
    }
    if (constantTimeEqual(actualFront, actualBack)) {
      throw new Error("Front and back images cannot be identical.");
    }

    const supabase = requireInstaCompJobSupabase();
    const storeId = getActiveStoreId();
    const { data: row, error: rowError } = await supabase
      .from("inventory_items")
      .select("id,legacy_product_id,seller_account_id,sku,title,description,quantity,price,metadata,status")
      .eq("id", itemId)
      .eq("store_id", storeId)
      .eq("status", "draft")
      .maybeSingle();
    if (rowError) throw rowError;
    if (!row) throw new Error("Pending draft was not found.");

    const metadata = recordValue(row.metadata);
    const instaComp = recordValue(metadata.instacomp);
    if (textValue(instaComp.scanId) !== scanId) {
      throw new Error("Mac scan ID does not match this pending draft.");
    }

    await ensureBucket();
    const [frontUrl, backUrl] = await Promise.all([
      uploadImage({ itemId, scanId, side: "front", file: front, hash: actualFront }),
      uploadImage({ itemId, scanId, side: "back", file: back, hash: actualBack }),
    ]);

    const now = new Date().toISOString();
    const productId = await ensureProduct({ row, frontUrl, now });
    const { error: deleteError } = await supabase
      .from("inventory_images")
      .delete()
      .eq("inventory_item_id", itemId);
    if (deleteError) throw deleteError;
    const { error: imageError } = await supabase.from("inventory_images").insert([
      {
        inventory_item_id: itemId,
        image_url: frontUrl,
        alt_text: `${row.title || "Card"} front`,
        sort_order: 0,
        is_primary: true,
      },
      {
        inventory_item_id: itemId,
        image_url: backUrl,
        alt_text: `${row.title || "Card"} back`,
        sort_order: 1,
        is_primary: false,
      },
    ]);
    if (imageError) throw imageError;

    const sellerReview = recordValue(metadata.seller_review);
    const nextMetadata = {
      ...metadata,
      ebay_image_urls: [frontUrl, backUrl],
      instacomp: {
        ...instaComp,
        scanId,
        frontSha256: actualFront,
        backSha256: actualBack,
        imagePairSha256: actualPair,
        hasBackImage: true,
        imageRequirement: "front_and_back_required_for_listing",
        imageRecoveryStatus: "recovered_by_authenticated_mac_push",
        imageRecoveredAt: now,
        recoveredImageUrls: { front: frontUrl, back: backUrl },
        sourceImageUrls: [frontUrl, backUrl],
      },
      seller_review: {
        ...sellerReview,
        identity_confirmed: false,
        confirmed_at: null,
        confirmed_by: null,
        confirmed_account_id: null,
        reset_at: now,
        reset_reason: "original_front_back_images_recovered_from_mac",
      },
    };
    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({
        legacy_product_id: productId,
        metadata: nextMetadata,
        updated_at: now,
      })
      .eq("id", itemId)
      .eq("store_id", storeId)
      .eq("status", "draft");
    if (updateError) throw updateError;

    return NextResponse.json({
      ok: true,
      inventoryItemId: itemId,
      scanId,
      productId,
      hasBackImage: true,
      frontUrl,
      backUrl,
      published: false,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
