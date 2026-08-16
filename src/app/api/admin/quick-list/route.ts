import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  INSTACOMP_JOB_IMAGE_BUCKET,
  InstaCompJobServerError,
  isAllowedInstaCompImageType,
  instaCompImageExtension,
  requireInstaCompJobActor,
  requireInstaCompJobSupabase,
} from "../../../../lib/instacomp-job-server";
import { normalizeInstaCompListingSerial } from "../../../../lib/instacomp-listing-serial";
import { InventoryEngine, InventoryRepository } from "../../../../modules/inventory";

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
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 999 ? parsed : null;
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

function clientRequestId(formData: FormData) {
  const supplied = textValue(formData, "clientRequestId", 80);
  if (!supplied) return randomUUID();
  if (!/^[a-zA-Z0-9_-]{12,80}$/.test(supplied)) {
    throw new InstaCompJobServerError(
      "Quick List request ID is invalid.",
      400,
      "QUICK_LIST_REQUEST_ID_INVALID",
    );
  }
  return supplied;
}

function quickListSku(requestId: string) {
  return `QL-${requestId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 36).toUpperCase()}`;
}

function validateImage(value: FormDataEntryValue | null, label: string) {
  if (!(value instanceof File) || value.size <= 0) {
    if (label === "Front") {
      throw new InstaCompJobServerError(
        "Upload the front card image.",
        400,
        "QUICK_LIST_FRONT_REQUIRED",
      );
    }

    return null;
  }

  if (!isAllowedInstaCompImageType(value.type)) {
    throw new InstaCompJobServerError(
      `${label} image must be JPEG, PNG, or WebP.`,
      400,
      "QUICK_LIST_IMAGE_TYPE_INVALID",
    );
  }

  if (value.size > MAX_IMAGE_BYTES) {
    throw new InstaCompJobServerError(
      `${label} image must be 12MB or smaller.`,
      413,
      "QUICK_LIST_IMAGE_TOO_LARGE",
    );
  }

  return value;
}

async function uploadDraftImage(params: {
  supabase: ReturnType<typeof requireInstaCompJobSupabase>;
  storeId: string;
  draftKey: string;
  side: "front" | "back";
  file: File;
}) {
  const path = [
    "quick-list",
    params.storeId,
    params.draftKey,
    `${params.side}.${instaCompImageExtension(params.file.type)}`,
  ].join("/");
  const { error: uploadError } = await params.supabase.storage
    .from(INSTACOMP_JOB_IMAGE_BUCKET)
    .upload(path, params.file, {
      contentType: params.file.type,
      cacheControl: "3600",
      upsert: true,
    });

  if (uploadError) {
    const missingBucket = /bucket.*not found|not found.*bucket/i.test(
      uploadError.message,
    );
    throw new InstaCompJobServerError(
      missingBucket
        ? "Quick List image storage is unavailable until the InstaComp™ private bucket is configured."
        : uploadError.message,
      missingBucket ? 503 : 500,
      missingBucket
        ? "QUICK_LIST_STORAGE_REQUIRED"
        : "QUICK_LIST_IMAGE_UPLOAD_FAILED",
    );
  }

  const { data: signedData, error: signedError } = await params.supabase.storage
    .from(INSTACOMP_JOB_IMAGE_BUCKET)
    .createSignedUrl(path, DRAFT_IMAGE_URL_TTL_SECONDS);

  if (signedError || !signedData?.signedUrl) {
    throw new InstaCompJobServerError(
      signedError?.message || "Could not authorize the draft image preview.",
      500,
      "QUICK_LIST_IMAGE_SIGNING_FAILED",
    );
  }

  return {
    path,
    signedUrl: signedData.signedUrl,
  };
}

async function findProductBySku(params: {
  supabase: ReturnType<typeof requireInstaCompJobSupabase>;
  storeId: string;
  sku: string;
}) {
  const { data, error } = await params.supabase
    .from("products")
    .select("id,sku,title,description,price,quantity,image_url,archived_at")
    .eq("store_id", params.storeId)
    .eq("sku", params.sku)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function POST(request: Request) {
  try {
    const actor = await requireInstaCompJobActor(request);

    if (actor.type !== "admin") {
      throw new InstaCompJobServerError(
        "Quick List is currently restricted to the Truely Collectables administrator.",
        403,
        "QUICK_LIST_ADMIN_REQUIRED",
      );
    }

    const supabase = requireInstaCompJobSupabase();
    const repository = new InventoryRepository(actor.storeId, supabase);
    const engine = new InventoryEngine(actor.storeId, repository, supabase);
    const formData = await request.formData();
    const requestId = clientRequestId(formData);
    const sku = quickListSku(requestId);
    const frontImage = validateImage(formData.get("frontImage"), "Front")!;
    const backImage = validateImage(formData.get("backImage"), "Back");
    const title = textValue(formData, "title", 240);
    const player = textValue(formData, "player", 160);
    const sport = textValue(formData, "sport", 100);
    const condition = textValue(formData, "condition", 100) || "Near Mint or Better";
    const scanId = textValue(formData, "scanId", 120);
    const price = positiveMoney(formData.get("price"));
    const quantity = positiveQuantity(formData.get("quantity"));
    const serialNumber = normalizeInstaCompListingSerial(
      textValue(formData, "serialNumber", 80),
    );
    const scanMetadata = cleanMetadata(formData.get("scanMetadata"));

    if (!title) {
      throw new InstaCompJobServerError(
        "A reviewed card title is required.",
        400,
        "QUICK_LIST_TITLE_REQUIRED",
      );
    }

    if (price === null) {
      throw new InstaCompJobServerError(
        "Enter a listing price greater than zero.",
        400,
        "QUICK_LIST_PRICE_REQUIRED",
      );
    }

    if (quantity === null) {
      throw new InstaCompJobServerError(
        "Quantity must be a whole number from 1 to 999.",
        400,
        "QUICK_LIST_QUANTITY_INVALID",
      );
    }

    // Upload to deterministic per-request paths first. We intentionally do not
    // delete these paths on an interrupted replay: another concurrent/retried
    // request with the same idempotency key may already have committed a product
    // that references them. Re-uploading is safe because upsert=true.
    const [front, back] = await Promise.all([
      uploadDraftImage({
        supabase,
        storeId: actor.storeId,
        draftKey: requestId,
        side: "front",
        file: frontImage,
      }),
      backImage
        ? uploadDraftImage({
            supabase,
            storeId: actor.storeId,
            draftKey: requestId,
            side: "back",
            file: backImage,
          })
        : Promise.resolve(null),
    ]);

    const descriptionParts = [
      title,
      player ? `Player/subject: ${player}.` : null,
      sport ? `Sport: ${sport}.` : null,
      serialNumber ? `Serial-numbered print run: ${serialNumber}.` : null,
      "Front and back images were processed through the Truely Collectables Quick List and InstaComp™ intake workflow.",
      "Draft listing: review all details before publishing to the storefront or a connected marketplace.",
    ].filter(Boolean);
    const description = descriptionParts.join("\n\n");

    let existingProduct = await findProductBySku({
      supabase,
      storeId: actor.storeId,
      sku,
    });
    let legacyProductId: number;
    let reused = Boolean(existingProduct);

    if (existingProduct) {
      legacyProductId = Number(existingProduct.id);
    } else {
      try {
        const draft = await engine.createSellerDraftProduct({
          sellerAccountId: null,
          title,
          description,
          category: sport || "sports_cards",
          condition,
          price,
          quantity,
          imageUrl: front.signedUrl,
          sku,
          ebayItemId: null,
        });
        legacyProductId = draft.legacyProductId;
      } catch (createError) {
        // A concurrent request can win the deterministic QL SKU insert after our
        // first lookup. Recover that exact product and continue repair instead
        // of surfacing a duplicate/conflict as permission to create again.
        existingProduct = await findProductBySku({
          supabase,
          storeId: actor.storeId,
          sku,
        });
        if (!existingProduct) throw createError;
        legacyProductId = Number(existingProduct.id);
        reused = true;
      }
    }

    const now = new Date().toISOString();
    const currentInventory = await repository.getByLegacyProductId(legacyProductId);
    const metadata = {
      ...(currentInventory?.metadata || {}),
      quick_list: {
        schema: "truely.quickListDraft.v3",
        created_at:
          (currentInventory?.metadata as any)?.quick_list?.created_at || now,
        repaired_at: reused ? now : null,
        client_request_id: requestId,
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

    // Reconcile the legacy row on every replay. archived_at is deliberately set
    // here so an interrupted draft cannot leak onto the public storefront before
    // the explicit set_site_active channel action clears it.
    const { data: product, error: productUpdateError } = await supabase
      .from("products")
      .update({
        title,
        description,
        price,
        quantity,
        image_url: front.signedUrl,
        player,
        sport,
        archived_at: existingProduct?.archived_at || now,
        last_seen_at: now,
      })
      .eq("id", legacyProductId)
      .eq("store_id", actor.storeId)
      .select("id,sku,title,price,quantity,image_url,archived_at")
      .single();
    if (productUpdateError) throw productUpdateError;

    const inventory = await repository.upsertBySku({
      seller_account_id: null,
      legacy_product_id: legacyProductId,
      sku,
      title,
      description,
      category: sport || "sports_cards",
      condition,
      status: "draft",
      quantity,
      price,
      currency: "USD",
      notes: "Seller-staged Quick List listing",
      metadata,
    });

    // A previous attempt may have stopped after creating only one image or may
    // have inserted the primary image before losing its response. Reset the
    // Quick List draft's image rows to the exact reviewed front/back pair so
    // eBay's front+back requirement cannot be satisfied by duplicate front URLs.
    const { error: imageResetError } = await supabase
      .from("inventory_images")
      .delete()
      .eq("inventory_item_id", inventory.id);
    if (imageResetError) throw imageResetError;

    await repository.addImage({
      inventoryItemId: inventory.id,
      imageUrl: front.signedUrl,
      altText: `${title} front`,
      sortOrder: 0,
      isPrimary: true,
    });
    if (back) {
      await repository.addImage({
        inventoryItemId: inventory.id,
        imageUrl: back.signedUrl,
        altText: `${title} back`,
        sortOrder: 1,
        isPrimary: false,
      });
    }

    const verifiedInventory = await repository.getByLegacyProductId(legacyProductId);
    const verifiedImages = verifiedInventory
      ? await repository.getImages(verifiedInventory.id)
      : [];
    if (
      !verifiedInventory ||
      verifiedInventory.sku !== sku ||
      verifiedInventory.status !== "draft" ||
      Math.round(Number(verifiedInventory.price || 0) * 100) !== Math.round(price * 100) ||
      Number(verifiedInventory.quantity) !== quantity ||
      verifiedImages.length !== (back ? 2 : 1) ||
      !verifiedImages.some((image) => image.is_primary) ||
      (back && !verifiedImages.some((image) => !image.is_primary))
    ) {
      throw new InstaCompJobServerError(
        "Quick List draft repair could not be verified. The existing product was left hidden from buyers.",
        500,
        "QUICK_LIST_REPAIR_VERIFICATION_FAILED",
      );
    }

    return NextResponse.json({
      success: true,
      reused,
      repaired: reused,
      draft: {
        inventoryItemId: verifiedInventory.id,
        legacyProductId,
        sku,
        title: product.title,
        price: Number(product.price || price),
        quantity: Number(product.quantity || quantity),
        serialNumber,
        status: "draft",
        editUrl: `/admin/products/${legacyProductId}`,
        frontImageUrl: front.signedUrl,
        backImageUrl: back?.signedUrl || null,
      },
    });
  } catch (error: any) {
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

    console.error("Quick List draft creation failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Quick List draft creation failed.",
        code: "QUICK_LIST_DRAFT_FAILED",
      },
      { status: 500 },
    );
  }
}
