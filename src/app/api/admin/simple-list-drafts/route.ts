import { createHash, randomUUID } from "node:crypto";
import { sanitizeAuthenticityProfile } from "../../../../../lib/authenticity";
import {
  requireInstaCompJobActor,
  InstaCompJobServerError,
  instaCompJobErrorResponse,
} from "../../../../../lib/instacomp-job-server";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import {
  inventoryEngine,
  InventoryEngineError,
} from "../../../../../modules/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

const IMAGE_BUCKET = process.env.INSTACOMP_DRAFT_IMAGE_BUCKET || "tcos-product-images";
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type SimpleListItem = {
  clientId?: unknown;
  scanId?: unknown;
  title?: unknown;
  price?: unknown;
  quantity?: unknown;
  searchQuery?: unknown;
  ai?: Record<string, unknown> | null;
  stats?: unknown;
  soldStats?: unknown;
  sourceCoverage?: unknown;
};

function cleanText(value: unknown, maxLength = 300) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function cleanMoney(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100) / 100) : 0;
}

function cleanQuantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function compactRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeFileExtension(file: File) {
  const nameExtension = cleanText(file.name.split(".").pop(), 10)?.toLowerCase();
  if (nameExtension && /^[a-z0-9]+$/.test(nameExtension)) {
    return nameExtension === "jpeg" ? "jpg" : nameExtension;
  }
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

function safeStoragePart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "card";
}

function skuForItem(params: {
  scanId: string | null;
  clientId: string | null;
  title: string;
}) {
  const hash = createHash("sha256")
    .update([params.scanId || "", params.clientId || "", params.title].join(":"))
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
  return `SL-${hash}`;
}

function itemDescription(params: {
  title: string;
  ai: Record<string, unknown>;
  scanId: string | null;
  searchQuery: string | null;
  hasBackImage: boolean;
}) {
  const ai = params.ai;
  const details = [
    cleanText(ai.player, 120) ? `Player/Subject: ${cleanText(ai.player, 120)}` : null,
    cleanText(ai.team, 120) ? `Team: ${cleanText(ai.team, 120)}` : null,
    cleanText(ai.sport, 80) ? `Sport: ${cleanText(ai.sport, 80)}` : null,
    cleanText(ai.year, 20) ? `Year: ${cleanText(ai.year, 20)}` : null,
    cleanText(ai.brand, 80) ? `Brand: ${cleanText(ai.brand, 80)}` : null,
    cleanText(ai.setName, 120) ? `Set: ${cleanText(ai.setName, 120)}` : null,
    cleanText(ai.cardNumber, 80) ? `Card Number: ${cleanText(ai.cardNumber, 80)}` : null,
    cleanText(ai.parallel, 120) ? `Parallel: ${cleanText(ai.parallel, 120)}` : null,
    cleanText(ai.serialNumber, 80) ? `Serial Number: ${cleanText(ai.serialNumber, 80)}` : null,
    cleanText(ai.gradingCompany, 40) ? `Grader: ${cleanText(ai.gradingCompany, 40)}` : null,
    cleanText(ai.gradeValue, 40) ? `Grade: ${cleanText(ai.gradeValue, 40)}` : null,
    cleanText(ai.certificationNumber, 80)
      ? `Certification Number: ${cleanText(ai.certificationNumber, 80)}`
      : null,
    ai.isRookie === true ? "Rookie: Yes" : null,
    ai.isAuto === true ? "Autograph: Yes — review authenticity disclosure" : null,
    ai.isRelic === true ? "Relic/Memorabilia: Yes" : null,
    cleanText(ai.conditionGuess, 80)
      ? `Condition Estimate: ${cleanText(ai.conditionGuess, 80)}`
      : null,
    params.hasBackImage ? "Images: Front and back" : "Images: Front only",
  ].filter(Boolean);

  return [
    params.title,
    "",
    ...details,
    "",
    "Created from the simplified Truely Collectables listing workflow. Review all fields and photos before publishing.",
    params.scanId ? `InstaComp™ Scan ID: ${params.scanId}` : null,
    params.searchQuery ? `Comp Query: ${params.searchQuery}` : null,
  ]
    .filter((value) => value !== null)
    .join("\n");
}

function authenticityFromAi(ai: Record<string, unknown>) {
  const gradingCompany = cleanText(ai.gradingCompany, 40);
  if (gradingCompany) {
    return sanitizeAuthenticityProfile({
      status: "verified_cert",
      certProvider: gradingCompany,
      certNumber: cleanText(ai.certificationNumber, 80),
      authenticityNotes: cleanText(ai.gradingEvidence, 500),
    });
  }

  if (ai.isAuto === true) {
    return sanitizeAuthenticityProfile({
      status: "unverified_as_is",
      autographSource: "other",
      authenticityNotes:
        "InstaComp™ detected an autograph. Verify the signer and authentication disclosure before publishing.",
    });
  }

  return sanitizeAuthenticityProfile(null);
}

async function ensureImageBucket(
  supabase: ReturnType<typeof createSupabaseServerClient>,
) {
  const { data, error } = await supabase.storage.getBucket(IMAGE_BUCKET);
  if (!error && data) return;

  const { error: createError } = await supabase.storage.createBucket(IMAGE_BUCKET, {
    public: true,
    fileSizeLimit: `${MAX_IMAGE_BYTES}`,
    allowedMimeTypes: Array.from(ALLOWED_IMAGE_TYPES),
  });
  if (createError && !createError.message.toLowerCase().includes("already exists")) {
    throw createError;
  }
}

async function uploadImage(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  sku: string;
  side: "front" | "back";
  file: File | null;
}) {
  const file = params.file;
  if (!file || file.size <= 0) return null;
  if (!ALLOWED_IMAGE_TYPES.has(file.type.toLowerCase())) {
    throw new InventoryEngineError("Card photos must be JPEG, PNG, or WebP images.", 400);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new InventoryEngineError("Each card photo must be 12MB or smaller.", 413);
  }

  await ensureImageBucket(params.supabase);
  const path = [
    safeStoragePart(params.storeId),
    "simple-list",
    safeStoragePart(params.sku),
    `${params.side}-${randomUUID()}.${safeFileExtension(file)}`,
  ].join("/");
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error } = await params.supabase.storage.from(IMAGE_BUCKET).upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  return params.supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function POST(request: Request) {
  try {
    const actor = await requireInstaCompJobActor(request);
    if (actor.type !== "admin") {
      return Response.json(
        { success: false, error: "The simplified /list workflow is owner/admin only." },
        { status: 403 },
      );
    }

    const formData = await request.formData();
    const rawItem = JSON.parse(String(formData.get("item") || "{}")) as SimpleListItem;
    const submittedFront = formData.get("frontImage");
    const submittedBack = formData.get("backImage");
    const frontImage = submittedFront instanceof File ? submittedFront : null;
    const backImage = submittedBack instanceof File ? submittedBack : null;
    const title = cleanText(rawItem.title, 200);
    const price = cleanMoney(rawItem.price);
    const quantity = cleanQuantity(rawItem.quantity);
    const clientId = cleanText(rawItem.clientId, 160);
    const scanId = cleanText(rawItem.scanId, 120);
    const searchQuery = cleanText(rawItem.searchQuery, 500);
    const ai = compactRecord(rawItem.ai);

    const validationErrors = [
      !frontImage ? "A front card photo is required." : null,
      !title ? "Listing title is required." : null,
      price <= 0 ? "Listing price must be greater than zero." : null,
      quantity < 1 ? "Quantity must be at least one." : null,
    ].filter(Boolean);
    if (validationErrors.length) {
      return Response.json(
        { success: false, error: validationErrors.join(" ") },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const sku = skuForItem({ scanId, clientId, title: title! });
    const { data: existing, error: existingError } = await supabase
      .from("inventory_items")
      .select("id,legacy_product_id,title,sku,price,quantity")
      .eq("store_id", storeId)
      .is("seller_account_id", null)
      .eq("sku", sku)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      return Response.json({
        success: true,
        alreadyExisted: true,
        inventoryItemId: existing.id,
        legacyProductId: existing.legacy_product_id,
        title: existing.title,
        sku: existing.sku,
        price: Number(existing.price || 0),
        quantity: Number(existing.quantity || 0),
      });
    }

    const [frontImageUrl, backImageUrl] = await Promise.all([
      uploadImage({ supabase, storeId, sku, side: "front", file: frontImage }),
      uploadImage({ supabase, storeId, sku, side: "back", file: backImage }),
    ]);
    const authenticity = authenticityFromAi(ai);
    const promoted = await inventoryEngine.createSellerDraftProduct({
      sellerAccountId: null,
      title: title!,
      description: itemDescription({
        title: title!,
        ai,
        scanId,
        searchQuery,
        hasBackImage: Boolean(backImageUrl),
      }),
      category: "sports_cards",
      condition: cleanText(ai.conditionGuess, 80) || "unknown",
      price,
      quantity,
      imageUrl: frontImageUrl,
      sku,
      authenticity,
    });

    if (!promoted.inventoryItemId) {
      throw new InventoryEngineError("The card draft was created without an inventory ID.", 500);
    }

    if (backImageUrl) {
      const { error: backImageError } = await supabase.from("inventory_images").insert({
        inventory_item_id: promoted.inventoryItemId,
        image_url: backImageUrl,
        alt_text: `${title} back`,
        sort_order: 1,
        is_primary: false,
      });
      if (backImageError) throw backImageError;
    }

    const { error: metadataError } = await supabase
      .from("inventory_items")
      .update({
        metadata: {
          authenticity,
          instacomp: {
            source: "simple_list",
            scanId,
            clientId,
            searchQuery,
            ai,
            stats: compactRecord(rawItem.stats),
            soldStats: compactRecord(rawItem.soldStats),
            sourceCoverage: Array.isArray(rawItem.sourceCoverage)
              ? rawItem.sourceCoverage.slice(0, 40)
              : [],
            frontImageUrl,
            backImageUrl,
          },
        },
      })
      .eq("id", promoted.inventoryItemId)
      .eq("store_id", storeId)
      .is("seller_account_id", null);
    if (metadataError) throw metadataError;

    return Response.json({
      success: true,
      alreadyExisted: false,
      inventoryItemId: promoted.inventoryItemId,
      legacyProductId: promoted.legacyProductId,
      title: promoted.title,
      sku,
      price,
      quantity,
      frontImageUrl,
      backImageUrl,
    });
  } catch (error) {
    if (
      error instanceof InstaCompJobServerError ||
      String((error as { code?: unknown })?.code || "").startsWith("INSTACOMP_")
    ) {
      return instaCompJobErrorResponse(error);
    }
    const status = error instanceof InventoryEngineError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Could not create the card draft.";
    console.error("Simple list draft error:", error);
    return Response.json({ success: false, error: message }, { status });
  }
}
