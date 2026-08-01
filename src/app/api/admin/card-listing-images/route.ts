import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  requireInstaCompJobActor,
  InstaCompJobServerError,
  instaCompJobErrorResponse,
} from "../../../../lib/instacomp-job-server";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

const IMAGE_BUCKET =
  process.env.INSTACOMP_DRAFT_IMAGE_BUCKET || "tcos-product-images";
const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
const BLOCKED_CHANNEL_STATUSES = new Set([
  "active",
  "publishing",
  "reconciliation_required",
]);

type UnknownRecord = Record<string, unknown>;
type ImageSide = "front" | "back";
type ImageAction = "rotate" | "swap";

type InventoryRow = {
  id: string;
  legacy_product_id: number | null;
  title: string;
  status: string;
  metadata: UnknownRecord | null;
};

type ProductRow = {
  id: number;
  image_url: string | null;
  ebay_item_id: string | null;
};

type InventoryImageRow = {
  inventory_item_id: string;
  image_url: string;
  sort_order: number | null;
  is_primary: boolean | null;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown, maximum = 2_000) {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maximum) : "";
}

function uniqueStrings(values: unknown[]) {
  return Array.from(
    new Set(values.map((value) => text(value)).filter(Boolean)),
  );
}

function safeStoragePart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "card";
}

function channelStatus(metadata: UnknownRecord, channel: "website" | "ebay") {
  return (
    text(record(record(metadata.dual_marketplace)[channel]).status, 60) ||
    "draft"
  );
}

function storageObject(url: string) {
  const marker = "/storage/v1/object/public/";
  const index = url.indexOf(marker);
  if (index < 0) return null;
  const remainder = url.slice(index + marker.length);
  const slash = remainder.indexOf("/");
  if (slash <= 0) return null;
  return {
    bucket: decodeURIComponent(remainder.slice(0, slash)),
    path: decodeURIComponent(remainder.slice(slash + 1)),
  };
}

async function requireAdmin(request: Request) {
  const actor = await requireInstaCompJobActor(request);
  if (actor.type !== "admin") {
    throw new InstaCompJobServerError(
      "Card image editing is owner/admin only.",
      403,
      "INSTACOMP_ADMIN_REQUIRED",
    );
  }
  return actor;
}

async function ensureImageBucket(
  supabase: ReturnType<typeof createSupabaseServerClient>,
) {
  const { data, error } = await supabase.storage.getBucket(IMAGE_BUCKET);
  if (!error && data) return;

  const { error: createError } = await supabase.storage.createBucket(
    IMAGE_BUCKET,
    {
      public: true,
      fileSizeLimit: `${MAX_SOURCE_IMAGE_BYTES}`,
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

async function loadCard(params: {
  inventoryItemId: string;
  storeId: string;
  supabase: ReturnType<typeof createSupabaseServerClient>;
}) {
  const { data: inventory, error: inventoryError } = await params.supabase
    .from("inventory_items")
    .select("id,legacy_product_id,title,status,metadata")
    .eq("store_id", params.storeId)
    .is("seller_account_id", null)
    .eq("id", params.inventoryItemId)
    .maybeSingle();
  if (inventoryError) throw inventoryError;
  if (!inventory) throw new Error("The selected card draft was not found.");

  let product: ProductRow | null = null;
  if (inventory.legacy_product_id) {
    const { data, error } = await params.supabase
      .from("products")
      .select("id,image_url,ebay_item_id")
      .eq("store_id", params.storeId)
      .is("seller_account_id", null)
      .eq("id", inventory.legacy_product_id)
      .maybeSingle();
    if (error) throw error;
    product = (data || null) as ProductRow | null;
  }

  const { data: images, error: imagesError } = await params.supabase
    .from("inventory_images")
    .select("inventory_item_id,image_url,sort_order,is_primary")
    .eq("inventory_item_id", params.inventoryItemId)
    .order("sort_order", { ascending: true });
  if (imagesError) throw imagesError;

  return {
    inventory: inventory as InventoryRow,
    product,
    images: (images || []) as InventoryImageRow[],
  };
}

function currentImagePair(card: Awaited<ReturnType<typeof loadCard>>) {
  const metadata = record(card.inventory.metadata);
  const instacomp = record(metadata.instacomp);
  const sorted = card.images.slice().sort((left, right) => {
    if (Boolean(left.is_primary) !== Boolean(right.is_primary)) {
      return left.is_primary ? -1 : 1;
    }
    return Number(left.sort_order || 0) - Number(right.sort_order || 0);
  });
  const front =
    text(instacomp.frontImageUrl) ||
    text(sorted.find((image) => image.is_primary)?.image_url) ||
    text(card.product?.image_url) ||
    text(sorted[0]?.image_url);
  const back =
    text(instacomp.backImageUrl) ||
    text(
      sorted.find(
        (image) => !image.is_primary && text(image.image_url) !== front,
      )?.image_url,
    ) ||
    text(sorted.find((image) => text(image.image_url) !== front)?.image_url);
  return { front, back };
}

function assertEditable(card: Awaited<ReturnType<typeof loadCard>>) {
  const metadata = record(card.inventory.metadata);
  const websiteStatus = channelStatus(metadata, "website");
  const ebayStatus = channelStatus(metadata, "ebay");

  if (card.inventory.status !== "draft") {
    throw new Error(
      "Only unpublished draft cards can be rotated or swapped from this queue.",
    );
  }
  if (
    BLOCKED_CHANNEL_STATUSES.has(websiteStatus) ||
    BLOCKED_CHANNEL_STATUSES.has(ebayStatus) ||
    card.product?.ebay_item_id
  ) {
    throw new Error(
      "This card is active, publishing, or linked to eBay. Its images cannot be changed here.",
    );
  }
}

async function rotateImage(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  inventoryItemId: string;
  side: ImageSide;
  sourceUrl: string;
  degrees: number;
}) {
  const response = await fetch(params.sourceUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`The ${params.side} image could not be downloaded.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) {
    throw new Error(`The ${params.side} image is empty.`);
  }
  if (bytes.length > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error("Card images must be 20MB or smaller for rotation.");
  }

  const rotated = await sharp(bytes, { failOn: "error" })
    .rotate(params.degrees, { background: "#ffffff" })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();

  await ensureImageBucket(params.supabase);
  const storagePath = [
    safeStoragePart(params.storeId),
    "card-image-edits",
    safeStoragePart(params.inventoryItemId),
    `${params.side}-${Date.now()}-${randomUUID()}.jpg`,
  ].join("/");
  const { error } = await params.supabase.storage
    .from(IMAGE_BUCKET)
    .upload(storagePath, rotated, {
      contentType: "image/jpeg",
      upsert: false,
      cacheControl: "31536000",
    });
  if (error) throw error;

  return params.supabase.storage.from(IMAGE_BUCKET).getPublicUrl(storagePath)
    .data.publicUrl;
}

async function replaceAssignedImages(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  inventoryItemId: string;
  title: string;
  previousFront: string;
  previousBack: string;
  front: string;
  back: string;
}) {
  const { error: primaryResetError } = await params.supabase
    .from("inventory_images")
    .update({ is_primary: false })
    .eq("inventory_item_id", params.inventoryItemId);
  if (primaryResetError) throw primaryResetError;

  const removableUrls = uniqueStrings([
    params.previousFront,
    params.previousBack,
    params.front,
    params.back,
  ]);
  if (removableUrls.length) {
    const { error: deleteError } = await params.supabase
      .from("inventory_images")
      .delete()
      .eq("inventory_item_id", params.inventoryItemId)
      .in("image_url", removableUrls);
    if (deleteError) throw deleteError;
  }

  const inserts = [
    {
      inventory_item_id: params.inventoryItemId,
      image_url: params.front,
      alt_text: `${params.title} front`,
      sort_order: 0,
      is_primary: true,
    },
    ...(params.back
      ? [
          {
            inventory_item_id: params.inventoryItemId,
            image_url: params.back,
            alt_text: `${params.title} back`,
            sort_order: 1,
            is_primary: false,
          },
        ]
      : []),
  ];
  const { error: insertError } = await params.supabase
    .from("inventory_images")
    .insert(inserts);
  if (insertError) throw insertError;
}

function nextMetadata(params: {
  metadata: UnknownRecord;
  action: ImageAction;
  side: ImageSide | null;
  degrees: number | null;
  front: string;
  back: string;
}) {
  const now = new Date().toISOString();
  const previousInstaComp = record(params.metadata.instacomp);
  const previousEditing = record(params.metadata.imageEditing);
  const previousHistory = Array.isArray(previousEditing.history)
    ? previousEditing.history.slice(-19)
    : [];
  const previousPendingImport = record(params.metadata.pendingImport);

  return {
    ...params.metadata,
    pendingImport:
      params.action === "swap"
        ? {
            ...previousPendingImport,
            frontImageFile: previousPendingImport.backImageFile || null,
            backImageFile: previousPendingImport.frontImageFile || null,
          }
        : previousPendingImport,
    instacomp: {
      ...previousInstaComp,
      status: "pending",
      version: "2.0",
      scanId: null,
      identityConfidence: null,
      listingPrice: null,
      searchQuery: null,
      decision: null,
      sourceCoverage: [],
      completedAt: null,
      invalidatedByImageEdit: true,
      lastImageEditAt: now,
      frontImageUrl: params.front,
      backImageUrl: params.back || null,
    },
    imageEditing: {
      ...previousEditing,
      revision: Number(previousEditing.revision || 0) + 1,
      lastAction: params.action,
      lastSide: params.side,
      lastDegrees: params.degrees,
      updatedAt: now,
      history: [
        ...previousHistory,
        {
          action: params.action,
          side: params.side,
          degrees: params.degrees,
          at: now,
          frontImageUrl: params.front,
          backImageUrl: params.back || null,
        },
      ],
    },
  };
}

async function removeOldStorageObject(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  url: string,
) {
  const object = storageObject(url);
  if (!object) return null;
  const { error } = await supabase.storage
    .from(object.bucket)
    .remove([object.path]);
  return error?.message || null;
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    const inventoryItemId = text(body.inventoryItemId, 80);
    const action = text(body.action, 20) as ImageAction;
    const side = text(body.side, 20) as ImageSide;
    const degrees = Number(body.degrees);

    if (!inventoryItemId) {
      return Response.json(
        { success: false, error: "inventoryItemId is required." },
        { status: 400 },
      );
    }
    if (action !== "rotate" && action !== "swap") {
      return Response.json(
        { success: false, error: "Use rotate or swap for image editing." },
        { status: 400 },
      );
    }
    if (
      action === "rotate" &&
      (!(["front", "back"] as string[]).includes(side) ||
        ![-90, 90, 180].includes(degrees))
    ) {
      return Response.json(
        {
          success: false,
          error: "Rotation requires side front/back and degrees -90, 90, or 180.",
        },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const card = await loadCard({ inventoryItemId, storeId, supabase });
    assertEditable(card);
    const previous = currentImagePair(card);
    if (!previous.front) throw new Error("This card does not have a front image.");
    if (action === "swap" && !previous.back) {
      throw new Error("Both a front and back image are required before swapping.");
    }
    if (action === "rotate" && side === "back" && !previous.back) {
      throw new Error("This card does not have a back image to rotate.");
    }

    let front = previous.front;
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
    }

    await replaceAssignedImages({
      supabase,
      inventoryItemId,
      title: card.inventory.title,
      previousFront: previous.front,
      previousBack: previous.back,
      front,
      back,
    });

    if (card.inventory.legacy_product_id) {
      const { error: productError } = await supabase
        .from("products")
        .update({ image_url: front, last_seen_at: new Date().toISOString() })
        .eq("store_id", storeId)
        .is("seller_account_id", null)
        .eq("id", card.inventory.legacy_product_id);
      if (productError) throw productError;
    }

    const metadata = nextMetadata({
      metadata: record(card.inventory.metadata),
      action,
      side: action === "rotate" ? side : null,
      degrees: action === "rotate" ? degrees : null,
      front,
      back,
    });
    const { error: metadataError } = await supabase
      .from("inventory_items")
      .update({ metadata, updated_at: new Date().toISOString() })
      .eq("store_id", storeId)
      .is("seller_account_id", null)
      .eq("id", inventoryItemId);
    if (metadataError) throw metadataError;

    const warnings: string[] = [];
    if (
      rotatedSourceUrl &&
      rotatedSourceUrl !== front &&
      rotatedSourceUrl !== back
    ) {
      const warning = await removeOldStorageObject(supabase, rotatedSourceUrl);
      if (warning) warnings.push(`Old image cleanup: ${warning}`);
    }

    return Response.json({
      success: true,
      action,
      inventoryItemId,
      frontImageUrl: front,
      backImageUrl: back || null,
      instaCompStatus: "pending",
      warnings,
      message:
        action === "swap"
          ? "Front and back images were swapped. InstaComp 2.0 was reset to pending."
          : `${side === "front" ? "Front" : "Back"} image rotated ${degrees > 0 ? "right" : "left"}. InstaComp 2.0 was reset to pending.`,
    });
  } catch (error) {
    if (
      error instanceof InstaCompJobServerError ||
      String((error as { code?: unknown })?.code || "").startsWith(
        "INSTACOMP_",
      )
    ) {
      return instaCompJobErrorResponse(error);
    }
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Card image editing failed.",
      },
      { status: 500 },
    );
  }
}
