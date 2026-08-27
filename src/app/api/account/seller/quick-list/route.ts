import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  INSTACOMP_JOB_IMAGE_BUCKET,
  InstaCompJobServerError,
  isAllowedInstaCompImageType,
  instaCompImageExtension,
  requireInstaCompJobActor,
  requireInstaCompJobSupabase,
} from "../../../../../lib/instacomp-job-server";
import { normalizeInstaCompListingSerial } from "../../../../../lib/instacomp-listing-serial";
import {
  InventoryEngine,
  InventoryRepository,
} from "../../../../../modules/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const DRAFT_IMAGE_URL_TTL_SECONDS = 30 * 24 * 60 * 60;

function textValue(formData: FormData, key: string, maxLength: number) {
  const value = String(formData.get(key) || "").trim();
  return value ? value.slice(0, maxLength) : null;
}

function positiveMoney(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed * 100) / 100
    : null;
}

function positiveQuantity(value: FormDataEntryValue | null) {
  const parsed = Number(value || 1);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 999
    ? parsed
    : null;
}

function cleanMetadata(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function validateImage(value: FormDataEntryValue | null, label: string) {
  if (!(value instanceof File) || value.size <= 0) {
    if (label === "Front") {
      throw new InstaCompJobServerError(
        "Upload the front card image.",
        400,
        "SELLER_QUICK_LIST_FRONT_REQUIRED",
      );
    }
    return null;
  }

  if (!isAllowedInstaCompImageType(value.type)) {
    throw new InstaCompJobServerError(
      `${label} image must be JPEG, PNG, or WebP.`,
      400,
      "SELLER_QUICK_LIST_IMAGE_TYPE_INVALID",
    );
  }

  if (value.size > MAX_IMAGE_BYTES) {
    throw new InstaCompJobServerError(
      `${label} image must be 12MB or smaller.`,
      413,
      "SELLER_QUICK_LIST_IMAGE_TOO_LARGE",
    );
  }

  return value;
}

async function uploadDraftImage(params: {
  supabase: ReturnType<typeof requireInstaCompJobSupabase>;
  storeId: string;
  sellerAccountId: string;
  draftKey: string;
  side: "front" | "back";
  file: File;
}) {
  const path = [
    "seller-quick-list",
    params.storeId,
    params.sellerAccountId,
    params.draftKey,
    `${params.side}.${instaCompImageExtension(params.file.type)}`,
  ].join("/");

  const { error: uploadError } = await params.supabase.storage
    .from(INSTACOMP_JOB_IMAGE_BUCKET)
    .upload(path, params.file, {
      contentType: params.file.type,
      cacheControl: "3600",
      upsert: false,
    });

  if (uploadError) {
    const missingBucket = /bucket.*not found|not found.*bucket/i.test(
      uploadError.message,
    );
    throw new InstaCompJobServerError(
      missingBucket
        ? "Seller Quick List storage is unavailable until the InstaComp™ private bucket is configured."
        : uploadError.message,
      missingBucket ? 503 : 500,
      missingBucket
        ? "SELLER_QUICK_LIST_STORAGE_REQUIRED"
        : "SELLER_QUICK_LIST_IMAGE_UPLOAD_FAILED",
    );
  }

  const { data: signedData, error: signedError } = await params.supabase.storage
    .from(INSTACOMP_JOB_IMAGE_BUCKET)
    .createSignedUrl(path, DRAFT_IMAGE_URL_TTL_SECONDS);

  if (signedError || !signedData?.signedUrl) {
    throw new InstaCompJobServerError(
      signedError?.message ||
        "Could not authorize the seller draft image preview.",
      500,
      "SELLER_QUICK_LIST_IMAGE_SIGNING_FAILED",
    );
  }

  return { path, signedUrl: signedData.signedUrl };
}

export async function POST(request: Request) {
  const uploadedPaths: string[] = [];

  try {
    const actor = await requireInstaCompJobActor(request);
    if (actor.type !== "seller") {
      throw new InstaCompJobServerError(
        "Seller Quick List requires an active seller account.",
        403,
        "SELLER_QUICK_LIST_SELLER_REQUIRED",
      );
    }

    const supabase = requireInstaCompJobSupabase();
    const formData = await request.formData();
    const frontImage = validateImage(formData.get("frontImage"), "Front")!;
    const backImage = validateImage(formData.get("backImage"), "Back");
    const title = textValue(formData, "title", 240);
    const player = textValue(formData, "player", 160);
    const sport = textValue(formData, "sport", 100);
    const category =
      textValue(formData, "category", 100) || sport || "sports_cards";
    const condition =
      textValue(formData, "condition", 100) || "Near Mint or Better";
    const scanId = textValue(formData, "scanId", 120);
    const price = positiveMoney(formData.get("price"));
    const quantity = positiveQuantity(formData.get("quantity"));
    const serialNumber = normalizeInstaCompListingSerial(
      textValue(formData, "serialNumber", 80),
    );
    const scanMetadata = cleanMetadata(formData.get("scanMetadata"));

    if (!title) {
      throw new InstaCompJobServerError(
        "A reviewed listing title is required.",
        400,
        "SELLER_QUICK_LIST_TITLE_REQUIRED",
      );
    }
    if (price === null) {
      throw new InstaCompJobServerError(
        "Enter a listing price greater than zero.",
        400,
        "SELLER_QUICK_LIST_PRICE_REQUIRED",
      );
    }
    if (quantity === null) {
      throw new InstaCompJobServerError(
        "Quantity must be a whole number from 1 to 999.",
        400,
        "SELLER_QUICK_LIST_QUANTITY_INVALID",
      );
    }

    const draftKey = randomUUID();
    const [front, back] = await Promise.all([
      uploadDraftImage({
        supabase,
        storeId: actor.storeId,
        sellerAccountId: actor.sellerAccountId,
        draftKey,
        side: "front",
        file: frontImage,
      }),
      backImage
        ? uploadDraftImage({
            supabase,
            storeId: actor.storeId,
            sellerAccountId: actor.sellerAccountId,
            draftKey,
            side: "back",
            file: backImage,
          })
        : Promise.resolve(null),
    ]);
    uploadedPaths.push(front.path);
    if (back?.path) uploadedPaths.push(back.path);

    const repository = new InventoryRepository(actor.storeId, supabase);
    const engine = new InventoryEngine(actor.storeId, repository, supabase);
    const sku = `SQL-${Date.now()}-${draftKey.slice(0, 8).toUpperCase()}`;
    const descriptionParts = [
      title,
      player ? `Player/subject: ${player}.` : null,
      sport ? `Sport/category: ${sport}.` : null,
      serialNumber ? `Serial-numbered print run: ${serialNumber}.` : null,
      "Front and back images were processed through the seller AI + InstaComp™ workflow.",
      "Private draft: review all details before activation or external publishing.",
    ].filter(Boolean);

    const draft = await engine.createSellerDraftProduct({
      sellerAccountId: actor.sellerAccountId,
      title,
      description: descriptionParts.join("\n\n"),
      category,
      condition,
      price,
      quantity,
      imageUrl: front.signedUrl,
      sku,
      ebayItemId: null,
    });

    if (!draft.inventoryItemId) {
      throw new InstaCompJobServerError(
        "Seller Quick List created the product row but could not resolve its inventory draft.",
        500,
        "SELLER_QUICK_LIST_DRAFT_BRIDGE_FAILED",
      );
    }

    const now = new Date().toISOString();
    const { data: currentInventory, error: currentInventoryError } =
      await supabase
        .from("inventory_items")
        .select("metadata")
        .eq("id", draft.inventoryItemId)
        .eq("store_id", actor.storeId)
        .eq("seller_account_id", actor.sellerAccountId)
        .single();

    if (currentInventoryError) throw currentInventoryError;

    const metadata = {
      ...(currentInventory?.metadata || {}),
      source: "seller_ai_quick_list",
      instacomp: true,
      quick_list: {
        schema: "truely.sellerQuickListDraft.v1",
        created_at: now,
        seller_account_id: actor.sellerAccountId,
        scan_id: scanId,
        normalized_serial_number: serialNumber,
        front_storage_path: front.path,
        back_storage_path: back?.path || null,
        front_original_filename: frontImage.name || null,
        back_original_filename: backImage?.name || null,
        image_url_ttl_seconds: DRAFT_IMAGE_URL_TTL_SECONDS,
        scan: scanMetadata,
      },
    };

    const updates = await Promise.all([
      supabase
        .from("products")
        .update({
          seller_account_id: actor.sellerAccountId,
          player,
          sport,
          last_seen_at: now,
        })
        .eq("id", draft.legacyProductId)
        .eq("store_id", actor.storeId),
      supabase
        .from("inventory_items")
        .update({
          seller_account_id: actor.sellerAccountId,
          category,
          condition,
          metadata,
          updated_at: now,
        })
        .eq("id", draft.inventoryItemId)
        .eq("store_id", actor.storeId),
    ]);

    if (updates[0].error) throw updates[0].error;
    if (updates[1].error) throw updates[1].error;

    if (back) {
      await repository.addImage({
        inventoryItemId: draft.inventoryItemId,
        imageUrl: back.signedUrl,
        altText: `${title} back`,
        sortOrder: 1,
        isPrimary: false,
      });
    }

    return NextResponse.json({
      success: true,
      draft: {
        inventoryItemId: draft.inventoryItemId,
        legacyProductId: draft.legacyProductId,
        sku,
        title,
        price,
        quantity,
        serialNumber,
        status: "draft",
        editUrl: `/seller/inventory?status=draft&search=${encodeURIComponent(
          sku,
        )}`,
        frontImageUrl: front.signedUrl,
        backImageUrl: back?.signedUrl || null,
      },
    });
  } catch (error: any) {
    if (uploadedPaths.length > 0) {
      try {
        const supabase = requireInstaCompJobSupabase();
        await supabase.storage
          .from(INSTACOMP_JOB_IMAGE_BUCKET)
          .remove(uploadedPaths);
      } catch {
        console.error(
          "Seller Quick List could not clean up failed draft images.",
        );
      }
    }

    if (error instanceof InstaCompJobServerError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: error.status },
      );
    }

    console.error("Seller Quick List draft creation failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Seller Quick List draft creation failed.",
        code: "SELLER_QUICK_LIST_DRAFT_FAILED",
      },
      { status: 500 },
    );
  }
}
