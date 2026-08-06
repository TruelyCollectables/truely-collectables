import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "./supabase-server";

const IMAGE_BUCKET =
  process.env.INSTACOMP_DRAFT_IMAGE_BUCKET || "tcos-product-images";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

type SupabaseServerClient = ReturnType<typeof createSupabaseServerClient>;

type OrientationReceipt = {
  status: string;
  model: string | null;
  frontRotation: number;
  backRotation: number;
  frontConfidence: number;
  backConfidence: number;
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

export async function persistNormalizedInstaCompImagePair(params: {
  supabase: SupabaseServerClient;
  storeId: string;
  inventoryItemId: string;
  title: string;
  frontFile: File;
  backFile: File;
  orientation: OrientationReceipt;
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

  const { error: imageDeleteError } = await params.supabase
    .from("inventory_images")
    .delete()
    .eq("inventory_item_id", params.inventoryItemId);
  if (imageDeleteError) throw imageDeleteError;

  const { error: imageInsertError } = await params.supabase
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
  if (imageInsertError) throw imageInsertError;

  const { data: item, error: itemError } = await params.supabase
    .from("inventory_items")
    .select("metadata")
    .eq("id", params.inventoryItemId)
    .eq("store_id", params.storeId)
    .maybeSingle();
  if (itemError) throw itemError;
  const metadata =
    item?.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
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
        },
      },
      updated_at: checkedAt,
    })
    .eq("id", params.inventoryItemId)
    .eq("store_id", params.storeId);
  if (metadataError) throw metadataError;

  return { frontImageUrl, backImageUrl };
}
