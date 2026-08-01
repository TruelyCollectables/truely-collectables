import { createHash, randomUUID } from "node:crypto";
import { sanitizeAuthenticityProfile } from "../../../../lib/authenticity";
import { buildCardListingTitle } from "../../../../lib/card-listing-title";
import {
  requireInstaCompJobActor,
  InstaCompJobServerError,
  instaCompJobErrorResponse,
} from "../../../../lib/instacomp-job-server";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import {
  inventoryEngine,
  InventoryEngineError,
} from "../../../../modules/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

const IMAGE_BUCKET = process.env.INSTACOMP_DRAFT_IMAGE_BUCKET || "tcos-product-images";
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type PendingImportItem = {
  client_id?: unknown;
  batch_id?: unknown;
  title?: unknown;
  front_image?: unknown;
  back_image?: unknown;
  player?: unknown;
  year?: unknown;
  manufacturer?: unknown;
  brand?: unknown;
  set_name?: unknown;
  subset?: unknown;
  card_number?: unknown;
  parallel?: unknown;
  serial_number?: unknown;
  title_print_run?: unknown;
  team?: unknown;
  sport?: unknown;
  rookie?: unknown;
  is_auto?: unknown;
  is_relic?: unknown;
  purchase_id?: unknown;
  cost_basis?: unknown;
  purchase_match_status?: unknown;
  identification_confidence?: unknown;
  notes?: unknown;
};

function cleanText(value: unknown, maxLength = 300) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxLength) : null;
}

function cleanMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed * 10_000) / 10_000
    : null;
}

function cleanBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "y"].includes(String(value || "").trim().toLowerCase());
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

function skuForItem(batchId: string, clientId: string) {
  const hash = createHash("sha256")
    .update(`${batchId}:${clientId}`)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
  return `PI-${hash}`;
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
  batchId: string;
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
    "pending-card-import",
    safeStoragePart(params.batchId),
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

function descriptionForItem(params: {
  title: string;
  item: PendingImportItem;
  hasBackImage: boolean;
}) {
  const item = params.item;
  const details = [
    cleanText(item.player, 120) ? `Player/Subject: ${cleanText(item.player, 120)}` : null,
    cleanText(item.team, 120) ? `Team: ${cleanText(item.team, 120)}` : null,
    cleanText(item.sport, 80) ? `Sport: ${cleanText(item.sport, 80)}` : null,
    cleanText(item.year, 20) ? `Year: ${cleanText(item.year, 20)}` : null,
    cleanText(item.manufacturer, 80)
      ? `Manufacturer: ${cleanText(item.manufacturer, 80)}`
      : null,
    cleanText(item.set_name, 120) ? `Set: ${cleanText(item.set_name, 120)}` : null,
    cleanText(item.card_number, 80)
      ? `Card Number: ${cleanText(item.card_number, 80)}`
      : null,
    cleanText(item.subset, 120) ? `Subset/Insert: ${cleanText(item.subset, 120)}` : null,
    cleanText(item.parallel, 120) ? `Parallel: ${cleanText(item.parallel, 120)}` : null,
    cleanText(item.serial_number, 80)
      ? `Full Serial Number: ${cleanText(item.serial_number, 80)}`
      : null,
    cleanBoolean(item.rookie) ? "Rookie: Yes" : null,
    params.hasBackImage ? "Images: Front and back" : "Images: Front only",
  ].filter(Boolean);

  return [
    params.title,
    "",
    "Pending InstaComp 2.0 review. This draft is not published.",
    "",
    ...details,
    "",
    "Review the exact identity, condition, market comps, and final price before publishing.",
  ].join("\n");
}

export async function POST(request: Request) {
  try {
    const actor = await requireInstaCompJobActor(request);
    if (actor.type !== "admin") {
      return Response.json(
        { success: false, error: "Pending card-package import is owner/admin only." },
        { status: 403 },
      );
    }

    const formData = await request.formData();
    const rawItem = JSON.parse(String(formData.get("item") || "{}")) as PendingImportItem;
    const submittedFront = formData.get("frontImage");
    const submittedBack = formData.get("backImage");
    const frontImage = submittedFront instanceof File ? submittedFront : null;
    const backImage = submittedBack instanceof File ? submittedBack : null;
    const clientId = cleanText(rawItem.client_id, 160);
    const batchId = cleanText(rawItem.batch_id || formData.get("batchId"), 160);

    const validationErrors = [
      !clientId ? "client_id is required." : null,
      !batchId ? "batch_id is required." : null,
      !frontImage ? "A front card photo is required." : null,
    ].filter(Boolean);
    if (validationErrors.length) {
      return Response.json(
        { success: false, error: validationErrors.join(" ") },
        { status: 400 },
      );
    }

    const title = buildCardListingTitle({
      year: rawItem.year,
      manufacturer: rawItem.manufacturer,
      brand: rawItem.brand,
      setName: rawItem.set_name,
      cardNumber: rawItem.card_number,
      player: rawItem.player,
      subset: rawItem.subset,
      parallel: rawItem.parallel,
      serialNumber: rawItem.serial_number,
      printRun: rawItem.title_print_run,
      isRookie: cleanBoolean(rawItem.rookie),
      isAuto: cleanBoolean(rawItem.is_auto),
      isRelic: cleanBoolean(rawItem.is_relic),
    });
    if (!title) {
      return Response.json(
        { success: false, error: "The card does not have enough identity data to build a title." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const sku = skuForItem(batchId!, clientId!);
    const { data: existing, error: existingError } = await supabase
      .from("inventory_items")
      .select("id,legacy_product_id,title,sku,price,quantity,status")
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
        status: existing.status,
      });
    }

    const [frontImageUrl, backImageUrl] = await Promise.all([
      uploadImage({
        supabase,
        storeId,
        batchId: batchId!,
        sku,
        side: "front",
        file: frontImage,
      }),
      uploadImage({
        supabase,
        storeId,
        batchId: batchId!,
        sku,
        side: "back",
        file: backImage,
      }),
    ]);

    const authenticity = sanitizeAuthenticityProfile(null);
    const promoted = await inventoryEngine.createSellerDraftProduct({
      sellerAccountId: null,
      title,
      description: descriptionForItem({
        title,
        item: rawItem,
        hasBackImage: Boolean(backImageUrl),
      }),
      category: "sports_cards",
      condition: "unknown",
      price: 0,
      quantity: 1,
      imageUrl: frontImageUrl,
      sku,
      authenticity,
    });

    if (!promoted.inventoryItemId) {
      throw new InventoryEngineError("The pending card draft was created without an inventory ID.", 500);
    }

    if (promoted.legacyProductId) {
      const { error: productError } = await supabase
        .from("products")
        .update({
          title,
          player: cleanText(rawItem.player, 120),
          sport: cleanText(rawItem.sport, 80) || "Sports Cards",
          price: 0,
          quantity: 1,
        })
        .eq("id", promoted.legacyProductId)
        .eq("store_id", storeId);
      if (productError) throw productError;
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

    const costBasis = cleanMoney(rawItem.cost_basis);
    const { error: metadataError } = await supabase
      .from("inventory_items")
      .update({
        metadata: {
          authenticity,
          pendingImport: {
            status: "pending_instacomp_2",
            batchId,
            clientId,
            source: "truely_collectables_scan_package",
            importedAt: new Date().toISOString(),
            titleRule:
              "year manufacturer/set #card-number player attributes print-run-denominator",
            originalManifestTitle: cleanText(rawItem.title, 200),
            originalIdentity: {
              player: cleanText(rawItem.player, 120),
              year: cleanText(rawItem.year, 20),
              manufacturer: cleanText(rawItem.manufacturer, 80),
              brand: cleanText(rawItem.brand, 80),
              setName: cleanText(rawItem.set_name, 120),
              subset: cleanText(rawItem.subset, 120),
              cardNumber: cleanText(rawItem.card_number, 80),
              parallel: cleanText(rawItem.parallel, 120),
              serialNumber: cleanText(rawItem.serial_number, 80),
              printRun: cleanText(rawItem.title_print_run, 80),
              team: cleanText(rawItem.team, 120),
              sport: cleanText(rawItem.sport, 80),
              isRookie: cleanBoolean(rawItem.rookie),
              isAuto: cleanBoolean(rawItem.is_auto),
              isRelic: cleanBoolean(rawItem.is_relic),
              identificationConfidence: cleanText(
                rawItem.identification_confidence,
                40,
              ),
              notes: cleanText(rawItem.notes, 1000),
            },
            frontImageFile: cleanText(rawItem.front_image, 300),
            backImageFile: cleanText(rawItem.back_image, 300),
          },
          cardIdentity: {
            player: cleanText(rawItem.player, 120),
            year: cleanText(rawItem.year, 20),
            manufacturer: cleanText(rawItem.manufacturer, 80),
            brand: cleanText(rawItem.brand, 80),
            setName: cleanText(rawItem.set_name, 120),
            subset: cleanText(rawItem.subset, 120),
            cardNumber: cleanText(rawItem.card_number, 80),
            parallel: cleanText(rawItem.parallel, 120),
            serialNumber: cleanText(rawItem.serial_number, 80),
            printRun: cleanText(rawItem.title_print_run, 80),
            team: cleanText(rawItem.team, 120),
            sport: cleanText(rawItem.sport, 80),
            isRookie: cleanBoolean(rawItem.rookie),
            isAuto: cleanBoolean(rawItem.is_auto),
            isRelic: cleanBoolean(rawItem.is_relic),
            identificationConfidence: cleanText(rawItem.identification_confidence, 40),
            notes: cleanText(rawItem.notes, 1000),
          },
          acquisition: {
            purchaseId: cleanText(rawItem.purchase_id, 160),
            costBasis,
            matchStatus: cleanText(rawItem.purchase_match_status, 160),
            pricingUse: "acquisition_cost_only",
            excludedFromInstaComp: true,
            excludedFromMarketComps: true,
          },
          instacomp: {
            status: "pending",
            version: "2.0",
            source: "pending_card_import",
            frontImageUrl,
            backImageUrl,
          },
        },
      })
      .eq("id", promoted.inventoryItemId)
      .eq("store_id", storeId)
      .is("seller_account_id", null);
    if (metadataError) throw metadataError;

    return Response.json(
      {
        success: true,
        alreadyExisted: false,
        inventoryItemId: promoted.inventoryItemId,
        legacyProductId: promoted.legacyProductId,
        title,
        sku,
        price: 0,
        quantity: 1,
        status: "draft",
        frontImageUrl,
        backImageUrl,
      },
      { status: 201 },
    );
  } catch (error) {
    if (
      error instanceof InstaCompJobServerError ||
      String((error as { code?: unknown })?.code || "").startsWith("INSTACOMP_")
    ) {
      return instaCompJobErrorResponse(error);
    }
    const status = error instanceof InventoryEngineError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : "Could not import the pending card draft.";
    console.error("Pending card import error:", error);
    return Response.json({ success: false, error: message }, { status });
  }
}
