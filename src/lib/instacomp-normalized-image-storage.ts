import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "./supabase-server";

const IMAGE_BUCKET =
  process.env.INSTACOMP_DRAFT_IMAGE_BUCKET || "tcos-product-images";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

type SupabaseServerClient = ReturnType<typeof createSupabaseServerClient>;
type StoredImageRow = {
  image_url: string | null;
  alt_text: string | null;
  sort_order: number | null;
  is_primary: boolean | null;
};

type OrientationReceipt = {
  status: string;
  model: string | null;
  frontRotation: number;
  backRotation: number;
  frontConfidence: number;
  backConfidence: number;
  frontEvidenceText?: string[];
  backEvidenceText?: string[];
  backStandalonePrizm?: boolean | null;
  backDesignationConfidence?: number;
  reason: string;
};

function safePart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "card";
}

function text(value: unknown) {
  const cleaned = String(value ?? "").trim();
  return cleaned || null;
}

function extension(file: File) {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

async function ensureBucket(supabase: SupabaseServerClient) {
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
  supabase: SupabaseServerClient;
  storeId: string;
  inventoryItemId: string;
  side: "front" | "back";
  file: File;
}) {
  if (!params.file.size || params.file.size > MAX_IMAGE_BYTES) {
    throw new Error(`${params.side} normalized image is empty or too large.`);
  }
  await ensureBucket(params.supabase);
  const path = [
    safePart(params.storeId),
    "instacomp-auto-oriented",
    safePart(params.inventoryItemId),
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

function assignedPair(rows: StoredImageRow[]) {
  const sorted = rows
    .filter((row) => text(row.image_url))
    .sort((left, right) => {
      if (Boolean(left.is_primary) !== Boolean(right.is_primary)) {
        return left.is_primary ? -1 : 1;
      }
      return Number(left.sort_order || 0) - Number(right.sort_order || 0);
    });
  const front =
    sorted.find((row) => /\bfront\b/i.test(row.alt_text || "")) ||
    sorted.find((row) => row.is_primary === true) ||
    sorted[0] ||
    null;
  const back =
    sorted.find(
      (row) =>
        /\bback\b/i.test(row.alt_text || "") &&
        row.image_url !== front?.image_url,
    ) ||
    sorted.find(
      (row) =>
        row.is_primary !== true && row.image_url !== front?.image_url,
    ) ||
    sorted.find((row) => row.image_url !== front?.image_url) ||
    null;
  return {
    frontImageUrl: text(front?.image_url),
    backImageUrl: text(back?.image_url),
  };
}

async function updateExistingRow(params: {
  supabase: SupabaseServerClient;
  inventoryItemId: string;
  previousUrl: string;
  nextUrl: string;
  altText: string;
  sortOrder: number;
  isPrimary: boolean;
}) {
  const { data, error } = await params.supabase
    .from("inventory_images")
    .update({
      image_url: params.nextUrl,
      alt_text: params.altText,
      sort_order: params.sortOrder,
      is_primary: params.isPrimary,
    })
    .eq("inventory_item_id", params.inventoryItemId)
    .eq("image_url", params.previousUrl)
    .select("image_url");
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function insertAssignedRow(params: {
  supabase: SupabaseServerClient;
  inventoryItemId: string;
  imageUrl: string;
  altText: string;
  sortOrder: number;
  isPrimary: boolean;
}) {
  const { error } = await params.supabase.from("inventory_images").insert({
    inventory_item_id: params.inventoryItemId,
    image_url: params.imageUrl,
    alt_text: params.altText,
    sort_order: params.sortOrder,
    is_primary: params.isPrimary,
  });
  if (error) throw error;
}

export async function persistNormalizedInstaCompImagePair(params: {
  supabase: SupabaseServerClient;
  storeId: string;
  inventoryItemId: string;
  title: string;
  frontFile: File;
  backFile: File;
  orientation: OrientationReceipt;
  previousFrontImageUrl?: string | null;
  previousBackImageUrl?: string | null;
}) {
  const [frontImageUrl, backImageUrl] = await Promise.all([
    upload({
      supabase: params.supabase,
      storeId: params.storeId,
      inventoryItemId: params.inventoryItemId,
      side: "front",
      file: params.frontFile,
    }),
    upload({
      supabase: params.supabase,
      storeId: params.storeId,
      inventoryItemId: params.inventoryItemId,
      side: "back",
      file: params.backFile,
    }),
  ]);

  const { data: currentRows, error: currentError } = await params.supabase
    .from("inventory_images")
    .select("image_url,alt_text,sort_order,is_primary")
    .eq("inventory_item_id", params.inventoryItemId)
    .order("sort_order", { ascending: true });
  if (currentError) throw currentError;
  const current = (currentRows || []) as StoredImageRow[];
  const currentPair = assignedPair(current);
  const previousFront =
    text(params.previousFrontImageUrl) || currentPair.frontImageUrl;
  const previousBack =
    text(params.previousBackImageUrl) || currentPair.backImageUrl;

  if (!current.length) {
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
  } else {
    const { error: primaryResetError } = await params.supabase
      .from("inventory_images")
      .update({ is_primary: false })
      .eq("inventory_item_id", params.inventoryItemId);
    if (primaryResetError) throw primaryResetError;

    const frontUpdated = previousFront
      ? await updateExistingRow({
          supabase: params.supabase,
          inventoryItemId: params.inventoryItemId,
          previousUrl: previousFront,
          nextUrl: frontImageUrl,
          altText: `${params.title} front`,
          sortOrder: 0,
          isPrimary: true,
        })
      : false;
    if (!frontUpdated) {
      await insertAssignedRow({
        supabase: params.supabase,
        inventoryItemId: params.inventoryItemId,
        imageUrl: frontImageUrl,
        altText: `${params.title} front`,
        sortOrder: 0,
        isPrimary: true,
      });
    }

    const backUpdated = previousBack
      ? await updateExistingRow({
          supabase: params.supabase,
          inventoryItemId: params.inventoryItemId,
          previousUrl: previousBack,
          nextUrl: backImageUrl,
          altText: `${params.title} back`,
          sortOrder: 1,
          isPrimary: false,
        })
      : false;
    if (!backUpdated) {
      await insertAssignedRow({
        supabase: params.supabase,
        inventoryItemId: params.inventoryItemId,
        imageUrl: backImageUrl,
        altText: `${params.title} back`,
        sortOrder: 1,
        isPrimary: false,
      });
    }
  }

  const { data: verifiedRows, error: verifyError } = await params.supabase
    .from("inventory_images")
    .select("image_url,alt_text,sort_order,is_primary")
    .eq("inventory_item_id", params.inventoryItemId)
    .order("sort_order", { ascending: true });
  if (verifyError) throw verifyError;
  const verified = assignedPair((verifiedRows || []) as StoredImageRow[]);
  if (
    verified.frontImageUrl !== frontImageUrl ||
    verified.backImageUrl !== backImageUrl
  ) {
    throw new Error(
      "Normalized image persistence failed its front/back read-back verification.",
    );
  }

  const { data: item, error: itemError } = await params.supabase
    .from("inventory_items")
    .select("metadata")
    .eq("id", params.inventoryItemId)
    .eq("store_id", params.storeId)
    .maybeSingle();
  if (itemError) throw itemError;
  const metadata =
    item?.metadata &&
    typeof item.metadata === "object" &&
    !Array.isArray(item.metadata)
      ? (item.metadata as Record<string, unknown>)
      : {};
  const instacomp =
    metadata.instacomp &&
    typeof metadata.instacomp === "object" &&
    !Array.isArray(metadata.instacomp)
      ? (metadata.instacomp as Record<string, unknown>)
      : {};
  const checkedAt = new Date().toISOString();
  const { error: metadataError } = await params.supabase
    .from("inventory_items")
    .update({
      metadata: {
        ...metadata,
        instacomp: {
          ...instacomp,
          frontImageUrl,
          backImageUrl,
          hasBackImage: true,
          imageOrientation: params.orientation,
          imageOrientationNormalizedAt: checkedAt,
          imageOrientationPersisted: true,
          imagePersistenceVerified: true,
        },
      },
      updated_at: checkedAt,
    })
    .eq("id", params.inventoryItemId)
    .eq("store_id", params.storeId);
  if (metadataError) throw metadataError;

  return {
    frontImageUrl,
    backImageUrl,
    verified: true,
    preservedAdditionalImages: Math.max(0, current.length - 2),
  };
}
