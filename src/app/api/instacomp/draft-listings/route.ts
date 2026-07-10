import { createHash } from "crypto";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../lib/account-auth";
import { sanitizeAuthenticityProfile } from "../../../../lib/authenticity";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import {
  inventoryEngine,
  InventoryEngineError,
} from "../../../../modules/inventory";

export const dynamic = "force-dynamic";

const INSTACOMP_DRAFT_IMAGE_BUCKET =
  process.env.INSTACOMP_DRAFT_IMAGE_BUCKET || "tcos-product-images";
const MAX_INSTACOMP_DRAFT_IMAGE_BYTES = 12 * 1024 * 1024;

type InstaCompDraftAi = {
  player?: string | null;
  year?: string | null;
  brand?: string | null;
  setName?: string | null;
  cardNumber?: string | null;
  parallel?: string | null;
  serialNumber?: string | null;
  team?: string | null;
  sport?: string | null;
  isRookie?: boolean;
  isAuto?: boolean;
  isRelic?: boolean;
  conditionGuess?: string | null;
  confidence?: number | null;
  notes?: string | null;
};

type InstaCompDraftRequestItem = {
  uploadIndex?: unknown;
  clientId?: unknown;
  scanId?: unknown;
  fileName?: unknown;
  backFileName?: unknown;
  hasBackImage?: unknown;
  title?: unknown;
  price?: unknown;
  marketPrice?: unknown;
  quantity?: unknown;
  searchQuery?: unknown;
  ai?: InstaCompDraftAi | null;
  stats?: unknown;
  soldStats?: unknown;
  sourceCoverage?: unknown;
  externalSearch?: unknown;
};

type ParsedDraftRequestItem = InstaCompDraftRequestItem & {
  frontImageFile?: File | null;
  backImageFile?: File | null;
};

type DraftListingSuccessItem = {
  clientId: string | null;
  scanId: string | null;
  legacyProductId: number | null;
  inventoryItemId: string | null;
  title: string;
  sku: string | null;
  price: number;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  alreadyExisted: boolean;
  metadataWarning?: string;
};

type ExistingInstaCompDraftRow = {
  id: string;
  legacy_product_id: number | string | null;
  title: string | null;
  sku: string | null;
  price: number | string | null;
  metadata: Record<string, unknown> | null;
};

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

async function parseDraftRequest(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.toLowerCase().includes("multipart/form-data")) {
    const formData = await request.formData();
    const itemsText = String(formData.get("items") || "[]");
    const rawItems = JSON.parse(itemsText) as InstaCompDraftRequestItem[];

    return rawItems.map<ParsedDraftRequestItem>((item, index) => {
      const uploadIndex = cleanText(item.uploadIndex, 24) || String(index);
      const frontImage = formData.get(`frontImage-${uploadIndex}`);
      const backImage = formData.get(`backImage-${uploadIndex}`);

      return {
        ...item,
        frontImageFile: frontImage instanceof File ? frontImage : null,
        backImageFile: backImage instanceof File ? backImage : null,
      };
    });
  }

  const body = await request.json().catch(() => ({}));
  const rawItems = Array.isArray(body?.items)
    ? (body.items as InstaCompDraftRequestItem[])
    : [];

  return rawItems.map<ParsedDraftRequestItem>((item) => ({
    ...item,
    frontImageFile: null,
    backImageFile: null,
  }));
}

function cleanText(value: unknown, maxLength = 300) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text.slice(0, maxLength) : null;
}

function cleanNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function moneyNumber(value: unknown) {
  const parsed = cleanNumber(value);
  return parsed === null ? 0 : Math.max(0, Math.round(parsed * 100) / 100);
}

function quantityNumber(value: unknown) {
  const parsed = cleanNumber(value);
  return parsed === null ? 1 : Math.max(0, Math.floor(parsed));
}

function compactRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function imageFileExtension(file: File) {
  const nameExtension = cleanText(file.name.split(".").pop(), 12)?.toLowerCase();

  if (nameExtension && /^[a-z0-9]+$/.test(nameExtension)) {
    return nameExtension === "jpeg" ? "jpg" : nameExtension;
  }

  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";

  return "jpg";
}

function safeStoragePart(value: string | null | undefined) {
  return String(value || "image")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "image";
}

async function ensureDraftImageBucket(
  supabase: ReturnType<typeof getSupabaseClient>,
) {
  const { data, error } = await supabase.storage.getBucket(
    INSTACOMP_DRAFT_IMAGE_BUCKET,
  );

  if (!error && data) return;

  const { error: createError } = await supabase.storage.createBucket(
    INSTACOMP_DRAFT_IMAGE_BUCKET,
    {
      public: true,
      fileSizeLimit: `${MAX_INSTACOMP_DRAFT_IMAGE_BYTES}`,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    },
  );

  if (createError && !createError.message.toLowerCase().includes("already exists")) {
    throw createError;
  }
}

async function uploadDraftImage(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  storeId: string;
  accountId: string;
  file: File | null | undefined;
  side: "front" | "back";
  sku: string;
}) {
  if (!params.file || params.file.size <= 0) return null;

  if (!params.file.type.startsWith("image/")) {
    throw new InventoryEngineError("InstaComp draft images must be image files.", 400);
  }

  if (params.file.size > MAX_INSTACOMP_DRAFT_IMAGE_BYTES) {
    throw new InventoryEngineError(
      "InstaComp draft images must be 12MB or smaller.",
      400,
    );
  }

  await ensureDraftImageBucket(params.supabase);

  const extension = imageFileExtension(params.file);
  const storagePath = [
    "instacomp",
    safeStoragePart(params.storeId),
    safeStoragePart(params.accountId),
    `${safeStoragePart(params.sku)}-${params.side}-${Date.now()}.${extension}`,
  ].join("/");
  const buffer = Buffer.from(await params.file.arrayBuffer());
  const { error } = await params.supabase.storage
    .from(INSTACOMP_DRAFT_IMAGE_BUCKET)
    .upload(storagePath, buffer, {
      cacheControl: "31536000",
      contentType: params.file.type || "image/jpeg",
      upsert: false,
    });

  if (error) throw error;

  const { data } = params.supabase.storage
    .from(INSTACOMP_DRAFT_IMAGE_BUCKET)
    .getPublicUrl(storagePath);

  return data.publicUrl || null;
}

function titleFromAi(ai: InstaCompDraftAi | null | undefined, fallback: string) {
  const title = [
    cleanText(ai?.year, 24),
    cleanText(ai?.brand, 80),
    cleanText(ai?.setName, 120),
    cleanText(ai?.player, 120),
    ai?.isRookie ? "Rookie" : null,
    cleanText(ai?.parallel, 120),
    ai?.cardNumber ? `#${cleanText(ai.cardNumber, 40)}` : null,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return title || fallback;
}

function categoryFromAi(ai: InstaCompDraftAi | null | undefined) {
  const sport = cleanText(ai?.sport, 80)?.toLowerCase() || "";

  if (!sport) return "trading_cards";
  if (["pokemon", "magic", "mtg", "yugioh"].some((term) => sport.includes(term))) {
    return "trading_cards";
  }

  return "sports_cards";
}

function conditionFromAi(ai: InstaCompDraftAi | null | undefined) {
  return cleanText(ai?.conditionGuess, 80) || "unknown";
}

function buildSku(params: {
  accountId: string;
  scanId: string | null;
  clientId: string | null;
  title: string;
  index: number;
}) {
  const hash = createHash("sha256")
    .update(
      [
        params.accountId,
        params.scanId || "",
        params.clientId || "",
        params.scanId || params.clientId ? "" : params.title,
        String(params.index),
      ].join(":"),
    )
    .digest("hex")
    .slice(0, 14)
    .toUpperCase();

  return `IC-${hash}`;
}

function buildAuthenticity(ai: InstaCompDraftAi | null | undefined) {
  if (!ai?.isAuto) {
    return sanitizeAuthenticityProfile(null);
  }

  return sanitizeAuthenticityProfile({
    status: "unverified_as_is",
    autographSource: "other",
    authenticityNotes:
      "InstaComp detected an autograph. Review certification and authenticity disclosure before activating this draft.",
  });
}

function buildDescription(params: {
  title: string;
  ai: InstaCompDraftAi | null | undefined;
  scanId: string | null;
  searchQuery: string | null;
  hasBackImage: boolean;
}) {
  const details = [
    params.ai?.player ? `Player/Subject: ${params.ai.player}` : null,
    params.ai?.team ? `Team: ${params.ai.team}` : null,
    params.ai?.sport ? `Sport: ${params.ai.sport}` : null,
    params.ai?.cardNumber ? `Card Number: ${params.ai.cardNumber}` : null,
    params.ai?.parallel ? `Parallel: ${params.ai.parallel}` : null,
    params.ai?.serialNumber ? `Serial Number: ${params.ai.serialNumber}` : null,
    params.ai?.isRookie ? "Rookie: Yes" : null,
    params.ai?.isAuto ? "Autograph: Review required" : null,
    params.ai?.isRelic ? "Relic/Memorabilia: Review required" : null,
    params.ai?.conditionGuess
      ? `Condition Estimate: ${params.ai.conditionGuess}`
      : null,
    params.hasBackImage
      ? "Image Sides: Front and back scan"
      : "Image Sides: Front-only scan",
  ].filter(Boolean);

  return [
    params.title,
    "",
    ...details,
    "",
    "Draft created from an InstaComp batch scan. Verify the photos, condition, authenticity, shipping, and final pricing before activation.",
    params.scanId ? `InstaComp Scan ID: ${params.scanId}` : null,
    params.searchQuery ? `Comp Query: ${params.searchQuery}` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function cleanSourceCoverage(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 40).map((entry) => {
    const row = compactRecord(entry);

    return {
      label: cleanText(row.label, 120),
      category: cleanText(row.category, 40),
      status: cleanText(row.status, 40),
      resultCount: cleanNumber(row.resultCount) ?? 0,
      includedInMarketValue: Boolean(row.includedInMarketValue),
    };
  });
}

function legacyProductIdNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function existingDraftSuccessItem(params: {
  row: ExistingInstaCompDraftRow;
  clientId: string | null;
  scanId: string | null;
}) {
  const metadata = compactRecord(params.row.metadata);
  const instacomp = compactRecord(metadata.instacomp);

  return {
    clientId: params.clientId,
    scanId: params.scanId,
    legacyProductId: legacyProductIdNumber(params.row.legacy_product_id),
    inventoryItemId: params.row.id,
    title: cleanText(params.row.title, 240) || "Existing InstaComp draft",
    sku: cleanText(params.row.sku, 120),
    price: moneyNumber(params.row.price),
    frontImageUrl: cleanText(instacomp.frontImageUrl, 2000),
    backImageUrl: cleanText(instacomp.backImageUrl, 2000),
    alreadyExisted: true,
    metadataWarning: "Draft already existed; no duplicate was created.",
  } satisfies DraftListingSuccessItem;
}

async function findExistingInstaCompDraft(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  storeId: string;
  accountId: string;
  sku: string;
  clientId: string | null;
  scanId: string | null;
}) {
  async function findBy(
    applyFilter: (query: any) => any,
  ) {
    const baseQuery = params.supabase
      .from("inventory_items")
      .select("id,legacy_product_id,title,sku,price,metadata")
      .eq("store_id", params.storeId)
      .eq("seller_account_id", params.accountId)
      .order("created_at", { ascending: false })
      .limit(1);
    const { data, error } = await applyFilter(baseQuery);

    if (error) throw error;

    return ((data || [])[0] as ExistingInstaCompDraftRow | undefined) || null;
  }

  const bySku = await findBy((query) => query.eq("sku", params.sku));

  if (bySku) return bySku;

  const byDedupeKey = await findBy((query) =>
    query.contains("metadata", { instacomp: { dedupeKey: params.sku } }),
  );

  if (byDedupeKey) return byDedupeKey;

  if (params.clientId) {
    const byClientId = await findBy((query) =>
      query.contains("metadata", { instacomp: { clientId: params.clientId } }),
    );

    if (byClientId) return byClientId;
  }

  if (params.scanId) {
    const byScanId = await findBy((query) =>
      query.contains("metadata", { instacomp: { scanId: params.scanId } }),
    );

    if (byScanId) return byScanId;
  }

  return null;
}

function isMissingInventoryTables(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("inventory_items") ||
    message.includes("products")
  );
}

function unavailableResponse() {
  return Response.json(
    {
      error:
        "InstaComp draft listing creation is not available until inventory migrations are applied.",
    },
    { status: 503 },
  );
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const items = (await parseDraftRequest(request)).slice(0, 500);

    if (items.length === 0) {
      return Response.json(
        { error: "At least one scanned InstaComp row is required." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const createdItems: DraftListingSuccessItem[] = [];
    let createdCount = 0;
    let existingCount = 0;
    const errors: Array<{
      clientId: string | null;
      scanId: string | null;
      title: string | null;
      error: string;
    }> = [];

    for (const [index, item] of items.entries()) {
      const ai = item.ai && typeof item.ai === "object" ? item.ai : null;
      const clientId = cleanText(item.clientId, 160);
      const scanId = cleanText(item.scanId, 120);
      const fallbackTitle =
        cleanText(item.fileName, 180) || `InstaComp Draft ${index + 1}`;
      const backFileName = cleanText(item.backFileName, 240);
      const hasBackImage = Boolean(item.hasBackImage || backFileName);
      const title = cleanText(item.title, 200) || titleFromAi(ai, fallbackTitle);
      const price = moneyNumber(item.price);
      const marketPrice = moneyNumber(item.marketPrice);
      const quantity = quantityNumber(item.quantity);
      const searchQuery = cleanText(item.searchQuery, 500);
      const validationErrors: string[] = [];

      if (!title) {
        validationErrors.push("Draft title is required.");
      }

      if (price <= 0) {
        validationErrors.push("Listing price must be greater than 0.");
      }

      if (quantity < 1) {
        validationErrors.push("Quantity must be at least 1.");
      }

      if (validationErrors.length) {
        errors.push({
          clientId,
          scanId,
          title,
          error: validationErrors.join(" "),
        });
        continue;
      }

      const sku = buildSku({
        accountId: account.id,
        scanId,
        clientId,
        title,
        index,
      });
      const authenticity = buildAuthenticity(ai);

      try {
        const existingDraft = await findExistingInstaCompDraft({
          supabase,
          storeId,
          accountId: account.id,
          sku,
          clientId,
          scanId,
        });

        if (existingDraft) {
          existingCount += 1;
          createdItems.push(
            existingDraftSuccessItem({
              row: existingDraft,
              clientId,
              scanId,
            }),
          );
          continue;
        }

        const frontImageUrl = await uploadDraftImage({
          supabase,
          storeId,
          accountId: account.id,
          file: item.frontImageFile,
          side: "front",
          sku,
        });
        const backImageUrl = await uploadDraftImage({
          supabase,
          storeId,
          accountId: account.id,
          file: item.backImageFile,
          side: "back",
          sku,
        });
        const promotedItem = await inventoryEngine.createSellerDraftProduct({
          sellerAccountId: account.id,
          title,
          description: buildDescription({
            title,
            ai,
            scanId,
            searchQuery,
            hasBackImage,
          }),
          category: categoryFromAi(ai),
          condition: conditionFromAi(ai),
          price,
          quantity,
          imageUrl: frontImageUrl,
          sku,
          authenticity,
        });

        let metadataWarning: string | undefined;

        if (promotedItem.inventoryItemId) {
          if (backImageUrl) {
            const { error: backImageError } = await supabase
              .from("inventory_images")
              .insert({
                inventory_item_id: promotedItem.inventoryItemId,
                image_url: backImageUrl,
                alt_text: `${promotedItem.title} back`,
                sort_order: 1,
                is_primary: false,
              });

            if (backImageError) {
              console.error("InstaComp draft back image insert error:", backImageError);
              metadataWarning = "Draft created, but back image was not attached.";
            }
          }

          const { error: metadataError } = await supabase
            .from("inventory_items")
            .update({
              metadata: {
                authenticity,
                instacomp: {
                  source: "batch_scan",
                  dedupeKey: sku,
                  scanId,
                  clientId,
                  fileName: cleanText(item.fileName, 240),
                  backFileName,
                  hasBackImage,
                  frontImageUrl,
                  backImageUrl,
                  searchQuery,
                  ai,
                  marketPrice,
                  listingPrice: price,
                  stats: compactRecord(item.stats),
                  soldStats: compactRecord(item.soldStats),
                  sourceCoverage: cleanSourceCoverage(item.sourceCoverage),
                  externalSearch: compactRecord(item.externalSearch),
                  createdAt: new Date().toISOString(),
                },
              },
              notes:
                "InstaComp batch draft - verify photos, condition, pricing, shipping, and authenticity before activation.",
              updated_at: new Date().toISOString(),
            })
            .eq("id", promotedItem.inventoryItemId)
            .eq("store_id", storeId)
            .eq("seller_account_id", account.id);

          if (metadataError) {
            console.error("InstaComp draft metadata update error:", metadataError);
            metadataWarning = metadataWarning
              ? `${metadataWarning} InstaComp metadata was not saved.`
              : "Draft created, but InstaComp metadata was not saved.";
          }
        }

        createdItems.push({
          clientId,
          scanId,
          legacyProductId: promotedItem.legacyProductId,
          inventoryItemId: promotedItem.inventoryItemId,
          title: promotedItem.title,
          sku: promotedItem.sku,
          price: promotedItem.price,
          frontImageUrl,
          backImageUrl,
          alreadyExisted: false,
          metadataWarning,
        });
        createdCount += 1;
      } catch (error: any) {
        if (isMissingInventoryTables(error)) {
          return unavailableResponse();
        }

        if (error instanceof InventoryEngineError && error.statusCode === 409) {
          const existingDraft = await findExistingInstaCompDraft({
            supabase,
            storeId,
            accountId: account.id,
            sku,
            clientId,
            scanId,
          });

          if (existingDraft) {
            existingCount += 1;
            createdItems.push(
              existingDraftSuccessItem({
                row: existingDraft,
                clientId,
                scanId,
              }),
            );
            continue;
          }
        }

        errors.push({
          clientId,
          scanId,
          title,
          error: error.message || "Could not create draft listing.",
        });
      }
    }

    return Response.json({
      success: errors.length === 0,
      createdCount,
      existingCount,
      errorCount: errors.length,
      createdItems,
      errors,
    });
  } catch (error: any) {
    if (isMissingInventoryTables(error)) {
      return unavailableResponse();
    }

    if (error instanceof InventoryEngineError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    return Response.json(
      {
        error: error.message || "Could not create InstaComp draft listings.",
      },
      { status: 500 },
    );
  }
}
