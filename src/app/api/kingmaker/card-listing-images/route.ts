import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { getAuthenticatedAccountFromRequest } from "../../../../lib/account-auth";
import {
  InstaCompJobServerError,
  instaCompJobErrorResponse,
  requireInstaCompJobActor,
} from "../../../../lib/instacomp-job-server";
import { assertSafeInstaCompRemoteImageUrl } from "../../../../lib/instacomp-provider-safety";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

const IMAGE_BUCKET =
  process.env.INSTACOMP_DRAFT_IMAGE_BUCKET || "tcos-product-images";
const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
const OWNER_EMAILS = new Set([
  "sales@truelycollectables.com",
  "sales@trulycollectables.com",
]);
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
  seller_account_id: string | null;
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

type ImageRow = {
  id: string | number;
  image_url: string;
  alt_text: string | null;
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

function channelStatus(metadata: UnknownRecord, channel: "website" | "ebay") {
  return (
    text(record(record(metadata.dual_marketplace)[channel]).status, 60) ||
    "draft"
  );
}

function safeStoragePart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "card";
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

async function authorizeOwner(request: Request) {
  const actor = await requireInstaCompJobActor(request);
  if (actor.type === "admin") {
    return {
      storeId: actor.storeId,
      sellerAccountId: null,
      allowAllStoreDrafts: true,
    };
  }

  const account = await getAuthenticatedAccountFromRequest(request);
  const email = String(account?.email || "").trim().toLowerCase();
  if (
    account?.id !== actor.sellerAccountId ||
    !OWNER_EMAILS.has(email)
  ) {
    throw new InstaCompJobServerError(
      "Card image editing is owner/admin only.",
      403,
      "INSTACOMP_ADMIN_REQUIRED",
    );
  }

  return {
    storeId: actor.storeId,
    sellerAccountId: actor.sellerAccountId,
    allowAllStoreDrafts: false,
  };
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

async function loadAuthorizedCard(params: {
  inventoryItemId: string;
  storeId: string;
  sellerAccountId: string | null;
  allowAllStoreDrafts: boolean;
  supabase: ReturnType<typeof createSupabaseServerClient>;
}) {
  let inventoryQuery = params.supabase
    .from("inventory_items")
    .select(
      "id,seller_account_id,legacy_product_id,title,status,metadata",
    )
    .eq("store_id", params.storeId)
    .eq("id", params.inventoryItemId)
    .eq("status", "draft");

  if (!params.allowAllStoreDrafts && params.sellerAccountId) {
    inventoryQuery = inventoryQuery.or(
      `seller_account_id.eq.${params.sellerAccountId},seller_account_id.is.null`,
    );
  }

  const { data: inventory, error: inventoryError } =
    await inventoryQuery.maybeSingle();
  if (inventoryError) throw inventoryError;
  if (!inventory) {
    throw new Error(
      "The selected draft was not found in the owner account or legacy inventory.",
    );
  }

  let product: ProductRow | null = null;
  if (inventory.legacy_product_id) {
    const { data, error } = await params.supabase
      .from("products")
      .select("id,image_url,ebay_item_id")
      .eq("store_id", params.storeId)
      .eq("id", inventory.legacy_product_id)
      .maybeSingle();
    if (error) throw error;
    product = (data || null) as ProductRow | null;
  }

  const { data: images, error: imagesError } = await params.supabase
    .from("inventory_images")
    .select("id,image_url,alt_text,sort_order,is_primary")
    .eq("inventory_item_id", params.inventoryItemId)
    .order("sort_order", { ascending: true });
  if (imagesError) throw imagesError;

  return {
    inventory: inventory as InventoryRow,
    product,
    images: (images || []) as ImageRow[],
  };
}

function pairFromRows(card: Awaited<ReturnType<typeof loadAuthorizedCard>>) {
  const rows = card.images.slice().sort((left, right) => {
    if (Boolean(left.is_primary) !== Boolean(right.is_primary)) {
      return left.is_primary ? -1 : 1;
    }
    return Number(left.sort_order || 0) - Number(right.sort_order || 0);
  });
  const frontRow =
    rows.find((row) => /\bfront\b/i.test(row.alt_text || "")) ||
    rows.find((row) => row.is_primary) ||
    rows.find((row) => Number(row.sort_order || 0) === 0) ||
    rows[0] ||
    null;
  const backRow =
    rows.find(
      (row) =>
        /\bback\b/i.test(row.alt_text || "") && row.id !== frontRow?.id,
    ) ||
    rows.find(
      (row) =>
        !row.is_primary &&
        Number(row.sort_order || 0) === 1 &&
        row.id !== frontRow?.id,
    ) ||
    rows.find((row) => row.id !== frontRow?.id) ||
    null;

  const metadata = record(card.inventory.metadata);
  const instacomp = record(metadata.instacomp);
  const front =
    text(frontRow?.image_url) ||
    text(instacomp.frontImageUrl) ||
    text(card.product?.image_url);
  const back = text(backRow?.image_url) || text(instacomp.backImageUrl);

  return { frontRow, backRow, front, back };
}

function assertEditable(card: Awaited<ReturnType<typeof loadAuthorizedCard>>) {
  const metadata = record(card.inventory.metadata);
  if (
    BLOCKED_CHANNEL_STATUSES.has(channelStatus(metadata, "website")) ||
    BLOCKED_CHANNEL_STATUSES.has(channelStatus(metadata, "ebay")) ||
    card.product?.ebay_item_id
  ) {
    throw new Error(
      "This card is active, publishing, or linked to eBay. Its images cannot be changed here.",
    );
  }
}

async function rotateAndUpload(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  inventoryItemId: string;
  side: ImageSide;
  sourceUrl: string;
  degrees: number;
}) {
  const safeUrl = assertSafeInstaCompRemoteImageUrl(params.sourceUrl);
  const response = await fetch(safeUrl, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(
      `The ${params.side} image returned HTTP ${response.status}.`,
    );
  }
  const sourceBytes = Buffer.from(await response.arrayBuffer());
  if (!sourceBytes.length || sourceBytes.length > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(
      `The ${params.side} image is empty or larger than 20MB.`,
    );
  }

  const normalizedSource = await sharp(sourceBytes, { failOn: "error" })
    .autoOrient()
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
  const rotated = await sharp(sourceBytes, { failOn: "error" })
    .autoOrient()
    .rotate(params.degrees, { background: "#ffffff" })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();

  const beforeSha256 = sha256(normalizedSource);
  const afterSha256 = sha256(rotated);
  if (beforeSha256 === afterSha256) {
    throw new Error(
      "Rotation produced identical image bytes; nothing was saved.",
    );
  }

  await ensureImageBucket(params.supabase);
  const storagePath = [
    safeStoragePart(params.storeId),
    "kingmaker-verified-rotations",
    safeStoragePart(params.inventoryItemId),
    `${params.side}-${Date.now()}-${randomUUID()}.jpg`,
  ].join("/");
  const { error: uploadError } = await params.supabase.storage
    .from(IMAGE_BUCKET)
    .upload(storagePath, rotated, {
      contentType: "image/jpeg",
      upsert: false,
      cacheControl: "31536000",
    });
  if (uploadError) throw uploadError;

  const publicUrl = params.supabase.storage
    .from(IMAGE_BUCKET)
    .getPublicUrl(storagePath).data.publicUrl;
  if (!publicUrl || publicUrl === params.sourceUrl) {
    throw new Error("Rotation upload did not create a new image URL.");
  }

  return { publicUrl, beforeSha256, afterSha256 };
}

async function assignImageRow(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  inventoryItemId: string;
  title: string;
  side: ImageSide;
  row: ImageRow | null;
  imageUrl: string;
}) {
  const values = {
    image_url: params.imageUrl,
    alt_text: `${params.title} ${params.side}`,
    sort_order: params.side === "front" ? 0 : 1,
    is_primary: params.side === "front",
  };

  if (params.row) {
    const { error } = await params.supabase
      .from("inventory_images")
      .update(values)
      .eq("id", params.row.id)
      .eq("inventory_item_id", params.inventoryItemId);
    if (error) throw error;
    return;
  }

  const { error } = await params.supabase.from("inventory_images").insert({
    inventory_item_id: params.inventoryItemId,
    ...values,
  });
  if (error) throw error;
}

function nextMetadata(params: {
  metadata: UnknownRecord;
  action: ImageAction;
  side: ImageSide | null;
  degrees: number | null;
  front: string;
  back: string;
  beforeSha256: string | null;
  afterSha256: string | null;
}) {
  const now = new Date().toISOString();
  const previousInstaComp = record(params.metadata.instacomp);
  const previousEditing = record(params.metadata.imageEditing);
  const history = Array.isArray(previousEditing.history)
    ? previousEditing.history.slice(-19)
    : [];

  return {
    ...params.metadata,
    instacomp: {
      ...previousInstaComp,
      status: "pending",
      scanId: null,
      humanVerified: false,
      trustedForIdentity: false,
      manualIdentityEdit: false,
      manualIdentityLocked: false,
      identityRefreshRequired: true,
      identityResolutionStatus: "awaiting_front_back_registry_rescan",
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
      lastBeforeSha256: params.beforeSha256,
      lastAfterSha256: params.afterSha256,
      history: [
        ...history,
        {
          action: params.action,
          side: params.side,
          degrees: params.degrees,
          at: now,
          frontImageUrl: params.front,
          backImageUrl: params.back || null,
          beforeSha256: params.beforeSha256,
          afterSha256: params.afterSha256,
        },
      ],
    },
  };
}

export async function POST(request: Request) {
  try {
    const authorization = await authorizeOwner(request);
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
        { success: false, error: "Use rotate or swap." },
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
          error: "Rotation requires front/back and -90, 90, or 180 degrees.",
        },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = authorization.storeId || getActiveStoreId();
    const card = await loadAuthorizedCard({
      inventoryItemId,
      storeId,
      sellerAccountId: authorization.sellerAccountId,
      allowAllStoreDrafts: authorization.allowAllStoreDrafts,
      supabase,
    });
    assertEditable(card);

    const pair = pairFromRows(card);
    if (!pair.front) throw new Error("This card does not have a front image.");
    if (!pair.back) throw new Error("This card does not have a back image.");

    let front = pair.front;
    let back = pair.back;
    let beforeSha256: string | null = null;
    let afterSha256: string | null = null;

    if (action === "swap") {
      front = pair.back;
      back = pair.front;
    } else {
      const sourceUrl = side === "front" ? pair.front : pair.back;
      const rotated = await rotateAndUpload({
        supabase,
        storeId,
        inventoryItemId,
        side,
        sourceUrl,
        degrees,
      });
      beforeSha256 = rotated.beforeSha256;
      afterSha256 = rotated.afterSha256;
      if (side === "front") front = rotated.publicUrl;
      else back = rotated.publicUrl;
    }

    const { error: resetPrimaryError } = await supabase
      .from("inventory_images")
      .update({ is_primary: false })
      .eq("inventory_item_id", inventoryItemId);
    if (resetPrimaryError) throw resetPrimaryError;

    await assignImageRow({
      supabase,
      inventoryItemId,
      title: card.inventory.title,
      side: "front",
      row: pair.frontRow,
      imageUrl: front,
    });
    await assignImageRow({
      supabase,
      inventoryItemId,
      title: card.inventory.title,
      side: "back",
      row: pair.backRow,
      imageUrl: back,
    });

    const metadata = nextMetadata({
      metadata: record(card.inventory.metadata),
      action,
      side: action === "rotate" ? side : null,
      degrees: action === "rotate" ? degrees : null,
      front,
      back,
      beforeSha256,
      afterSha256,
    });
    const { error: metadataError } = await supabase
      .from("inventory_items")
      .update({ metadata, updated_at: new Date().toISOString() })
      .eq("store_id", storeId)
      .eq("id", inventoryItemId);
    if (metadataError) throw metadataError;

    if (card.inventory.legacy_product_id) {
      const { error: productError } = await supabase
        .from("products")
        .update({ image_url: front, last_seen_at: new Date().toISOString() })
        .eq("store_id", storeId)
        .eq("id", card.inventory.legacy_product_id);
      if (productError) throw productError;
    }

    const { data: readBackRows, error: readBackError } = await supabase
      .from("inventory_images")
      .select("id,image_url,alt_text,sort_order,is_primary")
      .eq("inventory_item_id", inventoryItemId)
      .order("sort_order", { ascending: true });
    if (readBackError) throw readBackError;

    const readBackCard = {
      ...card,
      images: (readBackRows || []) as ImageRow[],
    };
    const readBackPair = pairFromRows(readBackCard);
    if (readBackPair.front !== front || readBackPair.back !== back) {
      throw new Error(
        "Rotation failed verification: stored front/back URLs did not match the new assignment.",
      );
    }

    return Response.json(
      {
        success: true,
        action,
        inventoryItemId,
        frontImageUrl: front,
        backImageUrl: back,
        beforeSha256,
        afterSha256,
        rotationVerified:
          action === "swap" ||
          Boolean(
            beforeSha256 &&
              afterSha256 &&
              beforeSha256 !== afterSha256,
          ),
        storageVerified: true,
        message:
          action === "swap"
            ? "Front and back were swapped and verified in storage."
            : `${side === "front" ? "Front" : "Back"} rotated ${degrees > 0 ? "right" : "left"} and verified in storage.`,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
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
            : "Verified card image editing failed.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
