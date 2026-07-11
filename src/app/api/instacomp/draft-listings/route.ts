import { createHash, randomUUID } from "crypto";
import { sanitizeAuthenticityProfile } from "../../../../lib/authenticity";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import {
  INSTACOMP_JOB_IMAGE_BUCKET,
  INSTACOMP_JOB_ITEM_TABLE,
  INSTACOMP_JOB_TABLE,
  instaCompJobErrorResponse,
  requireInstaCompJobActor,
  throwInstaCompRpcError,
} from "../../../../lib/instacomp-job-server";
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
  persistentJobId?: unknown;
  persistentItemId?: unknown;
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

function scopeSellerAccount<T>(query: T, sellerAccountId: string | null): T {
  return (sellerAccountId
    ? (query as any).eq("seller_account_id", sellerAccountId)
    : (query as any).is("seller_account_id", null)) as T;
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

function cleanUuid(value: unknown) {
  const text = cleanText(value, 64);

  return text &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      text,
    )
    ? text
    : null;
}

async function persistentDraftImageFiles(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  storeId: string;
  sellerAccountId: string | null;
  jobId: string | null;
  itemId: string | null;
}) {
  if (!params.jobId && !params.itemId) {
    return {
      frontFile: null,
      backFile: null,
      item: null,
    };
  }

  if (!params.jobId || !params.itemId) {
    throw new InventoryEngineError(
      "A persistent InstaComp draft requires both its job ID and item ID.",
      400,
    );
  }

  let jobQuery = params.supabase
    .from(INSTACOMP_JOB_TABLE)
    .select("id,status")
    .eq("id", params.jobId)
    .eq("store_id", params.storeId);
  jobQuery = scopeSellerAccount(jobQuery, params.sellerAccountId);
  const { data: job, error: jobError } = await jobQuery.maybeSingle();

  if (jobError) throw jobError;

  if (!job) {
    throw new InventoryEngineError(
      "The persistent InstaComp job was not found for this seller.",
      404,
    );
  }

  if (["cancelling", "cancelled", "failed"].includes(String(job.status))) {
    throw new InventoryEngineError(
      "A cancelling, cancelled, or failed InstaComp job cannot create drafts.",
      409,
    );
  }

  const { data: item, error: itemError } = await params.supabase
    .from(INSTACOMP_JOB_ITEM_TABLE)
    .select(
      "id,job_id,status,front_storage_path,back_storage_path,front_original_filename,back_original_filename,front_content_type,back_content_type,front_size_bytes,back_size_bytes,front_image_sha256,back_image_sha256,draft_inventory_item_id,result_payload",
    )
    .eq("id", params.itemId)
    .eq("job_id", params.jobId)
    .maybeSingle();

  if (itemError) throw itemError;

  if (!item?.front_storage_path) {
    throw new InventoryEngineError(
      "The persistent InstaComp row is missing its front image.",
      409,
    );
  }

  if (!["completed", "review_required"].includes(String(item.status))) {
    throw new InventoryEngineError(
      "Finish or review the InstaComp scan before creating its draft.",
      409,
    );
  }

  if (item.draft_inventory_item_id) {
    return { frontFile: null, backFile: null, item };
  }

  async function download(
    path: string | null,
    fileName: string | null,
    contentType: string | null,
    expectedSizeBytes: number | null,
    expectedSha256: string | null,
  ) {
    if (!path) return null;

    const { data, error } = await params.supabase.storage
      .from(INSTACOMP_JOB_IMAGE_BUCKET)
      .download(path);

    if (error || !data) {
      throw new InventoryEngineError(
        error?.message || "Could not load the persistent InstaComp image.",
        500,
      );
    }

    const bytes = await data.arrayBuffer();

    if (
      expectedSizeBytes !== null &&
      bytes.byteLength !== expectedSizeBytes
    ) {
      throw new InventoryEngineError(
        "A persistent InstaComp image changed size after it was scanned.",
        409,
      );
    }

    if (!expectedSha256) {
      throw new InventoryEngineError(
        "A persistent InstaComp image is missing its required integrity digest.",
        409,
      );
    }

    const actualSha256 = createHash("sha256")
      .update(Buffer.from(bytes))
      .digest("hex");

    if (actualSha256 !== expectedSha256.toLowerCase()) {
      throw new InventoryEngineError(
        "A persistent InstaComp image changed after it was scanned. Cancel this row and upload it again.",
        409,
      );
    }

    return new File([bytes], fileName || "instacomp-card.jpg", {
      type: contentType || data.type || "image/jpeg",
    });
  }

  const [frontFile, backFile] = await Promise.all([
    download(
      item.front_storage_path,
      item.front_original_filename,
      item.front_content_type,
      Number(item.front_size_bytes),
      item.front_image_sha256 || null,
    ),
    download(
      item.back_storage_path,
      item.back_original_filename,
      item.back_content_type,
      item.back_size_bytes === null || item.back_size_bytes === undefined
        ? null
        : Number(item.back_size_bytes),
      item.back_image_sha256 || null,
    ),
  ]);

  return { frontFile, backFile, item };
}

async function markPersistentItemDrafted(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  storeId: string;
  sellerAccountId: string | null;
  jobId: string | null;
  itemId: string | null;
  inventoryItemId: string | null;
  reservationToken: string | null;
}) {
  if (!params.jobId || !params.itemId || !params.inventoryItemId) return;

  let ownedJobQuery = params.supabase
    .from(INSTACOMP_JOB_TABLE)
    .select("id")
    .eq("id", params.jobId)
    .eq("store_id", params.storeId);
  ownedJobQuery = scopeSellerAccount(
    ownedJobQuery,
    params.sellerAccountId,
  );
  const { data: ownedJob, error: ownedJobError } =
    await ownedJobQuery.maybeSingle();

  if (ownedJobError) throw ownedJobError;

  if (!ownedJob) {
    throw new InventoryEngineError(
      "The persistent InstaComp job was not found for this seller.",
      404,
    );
  }

  if (!params.reservationToken) {
    throw new InventoryEngineError(
      "The persistent InstaComp row does not have an active draft reservation.",
      409,
    );
  }

  const { data, error } = await params.supabase.rpc(
    "tcos_finish_instacomp_scan_item_draft",
    {
      p_item_id: params.itemId,
      p_reservation_token: params.reservationToken,
      p_draft_inventory_item_id: params.inventoryItemId,
    },
  );

  if (error) throwInstaCompRpcError(error);

  const draftedItem = Array.isArray(data) ? data[0] : data;

  if (
    !draftedItem ||
    draftedItem.draft_inventory_item_id !== params.inventoryItemId
  ) {
    throw new InventoryEngineError(
      "The InstaComp row could not be linked to its reserved draft.",
      409,
    );
  }
}

async function reservePersistentItemDraft(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  itemId: string | null;
}) {
  if (!params.itemId) {
    return { reservationToken: null, item: null };
  }

  const reservationToken = randomUUID();
  const { data, error } = await params.supabase.rpc(
    "tcos_reserve_instacomp_scan_item_draft",
    {
      p_item_id: params.itemId,
      p_reservation_token: reservationToken,
      p_lease_seconds: 900,
    },
  );

  if (error) throwInstaCompRpcError(error);

  return {
    reservationToken,
    item: (Array.isArray(data) ? data[0] : data) as Record<string, any> | null,
  };
}

async function releasePersistentItemDraftReservation(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  itemId: string | null;
  reservationToken: string | null;
}) {
  if (!params.itemId || !params.reservationToken) return;

  const { error } = await params.supabase.rpc(
    "tcos_release_instacomp_scan_item_draft",
    {
      p_item_id: params.itemId,
      p_reservation_token: params.reservationToken,
    },
  );

  if (error) {
    console.error("InstaComp draft reservation release error:", error);
  }
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
  sellerAccountId: string | null;
  sku: string;
  clientId: string | null;
  scanId: string | null;
}) {
  async function findBy(
    applyFilter: (query: any) => any,
  ) {
    let baseQuery = params.supabase
      .from("inventory_items")
      .select("id,legacy_product_id,title,sku,price,metadata")
      .eq("store_id", params.storeId)
      .order("created_at", { ascending: false })
      .limit(1);
    baseQuery = scopeSellerAccount(baseQuery, params.sellerAccountId);
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

async function findOwnedInventoryItemById(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  storeId: string;
  sellerAccountId: string | null;
  inventoryItemId: string;
}) {
  let query = params.supabase
    .from("inventory_items")
    .select("id,legacy_product_id,title,sku,price,metadata")
    .eq("id", params.inventoryItemId)
    .eq("store_id", params.storeId);
  query = scopeSellerAccount(query, params.sellerAccountId);
  const { data, error } = await query.maybeSingle();

  if (error) throw error;

  return (data as ExistingInstaCompDraftRow | null) || null;
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
    const actor = await requireInstaCompJobActor(request);
    const sellerAccountId = actor.sellerAccountId;
    const ownerKey = sellerAccountId || "admin-store-inventory";

    const items = (await parseDraftRequest(request)).slice(0, 500);

    if (items.length === 0) {
      return Response.json(
        { error: "At least one scanned InstaComp row is required." },
        { status: 400 },
      );
    }

    if (
      process.env.NODE_ENV === "production" &&
      items.some(
        (item) => !cleanUuid(item.persistentJobId) || !cleanUuid(item.persistentItemId),
      )
    ) {
      return Response.json(
        {
          error:
            "Production InstaComp drafts require a completed persistent queue row.",
          code: "INSTACOMP_PERSISTENT_DRAFT_REQUIRED",
        },
        { status: 409 },
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
      const persistentJobId = cleanUuid(item.persistentJobId);
      const persistentItemId = cleanUuid(item.persistentItemId);
      const validationErrors: string[] = [];

      if (item.persistentJobId && !persistentJobId) {
        validationErrors.push("Persistent InstaComp job ID is invalid.");
      }

      if (item.persistentItemId && !persistentItemId) {
        validationErrors.push("Persistent InstaComp item ID is invalid.");
      }

      if (Boolean(persistentJobId) !== Boolean(persistentItemId)) {
        validationErrors.push(
          "Persistent InstaComp job and item IDs must be provided together.",
        );
      }

      if (
        persistentItemId &&
        (item.frontImageFile || item.backImageFile)
      ) {
        validationErrors.push(
          "Persistent InstaComp drafts must use their verified private images; do not attach replacement files.",
        );
      }

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
        accountId: ownerKey,
        scanId: persistentItemId || scanId,
        clientId: persistentItemId ? null : clientId,
        title,
        index: persistentItemId ? 0 : index,
      });

      let draftReservationToken: string | null = null;

      try {
        const persistentImages = await persistentDraftImageFiles({
          supabase,
          storeId,
          sellerAccountId,
          jobId: persistentJobId,
          itemId: persistentItemId,
        });
        const linkedInventoryItemId = cleanUuid(
          persistentImages.item?.draft_inventory_item_id,
        );

        if (linkedInventoryItemId) {
          const linkedInventoryItem = await findOwnedInventoryItemById({
            supabase,
            storeId,
            sellerAccountId,
            inventoryItemId: linkedInventoryItemId,
          });

          if (!linkedInventoryItem) {
            throw new InventoryEngineError(
              "This InstaComp row is linked to an inventory item that is no longer available. An operator must repair the link before retrying.",
              409,
            );
          }

          existingCount += 1;
          createdItems.push(
            existingDraftSuccessItem({
              row: linkedInventoryItem,
              clientId,
              scanId,
            }),
          );
          continue;
        }

        if (persistentItemId) {
          const reservation = await reservePersistentItemDraft({
            supabase,
            itemId: persistentItemId,
          });
          const reservationLinkedInventoryItemId = cleanUuid(
            reservation.item?.draft_inventory_item_id,
          );

          if (reservationLinkedInventoryItemId) {
            const linkedInventoryItem = await findOwnedInventoryItemById({
              supabase,
              storeId,
              sellerAccountId,
              inventoryItemId: reservationLinkedInventoryItemId,
            });

            if (!linkedInventoryItem) {
              throw new InventoryEngineError(
                "This InstaComp row is linked to an inventory item that is no longer available. An operator must repair the link before retrying.",
                409,
              );
            }

            existingCount += 1;
            createdItems.push(
              existingDraftSuccessItem({
                row: linkedInventoryItem,
                clientId,
                scanId,
              }),
            );
            continue;
          }

          draftReservationToken = reservation.reservationToken;
        }

        const existingDraft = await findExistingInstaCompDraft({
          supabase,
          storeId,
          sellerAccountId,
          sku,
          clientId: persistentItemId ? null : clientId,
          scanId: persistentItemId ? null : scanId,
        });

        if (existingDraft) {
          await markPersistentItemDrafted({
            supabase,
            storeId,
            sellerAccountId,
            jobId: persistentJobId,
            itemId: persistentItemId,
            inventoryItemId: existingDraft.id,
            reservationToken: draftReservationToken,
          });
          draftReservationToken = null;
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

        const persistedResult = compactRecord(
          persistentImages.item?.result_payload,
        );
        const effectiveAi =
          persistentItemId && Object.keys(compactRecord(persistedResult.ai)).length
            ? (compactRecord(persistedResult.ai) as InstaCompDraftAi)
            : ai;
        const effectiveSearchQuery =
          persistentItemId
            ? cleanText(persistedResult.searchQuery, 500) || searchQuery
            : searchQuery;
        const effectiveStats = persistentItemId
          ? compactRecord(persistedResult.stats)
          : compactRecord(item.stats);
        const effectiveSoldStats = persistentItemId
          ? compactRecord(persistedResult.soldStats)
          : compactRecord(item.soldStats);
        const effectiveSourceCoverage = persistentItemId
          ? cleanSourceCoverage(persistedResult.sourceCoverage)
          : cleanSourceCoverage(item.sourceCoverage);
        const effectiveExternalSearch = persistentItemId
          ? compactRecord(
              compactRecord(
                (Array.isArray(persistedResult.providers)
                  ? persistedResult.providers
                  : []
                ).find(
                  (provider: any) =>
                    provider?.source === "external_comp_search",
                )?.diagnostics,
              ).externalSearch,
            )
          : compactRecord(item.externalSearch);
        const authenticity = buildAuthenticity(effectiveAi);
        const effectiveHasBackImage = persistentItemId
          ? Boolean(persistentImages.backFile)
          : hasBackImage;

        const frontImageUrl = await uploadDraftImage({
          supabase,
          storeId,
          accountId: ownerKey,
          file: persistentItemId
            ? persistentImages.frontFile
            : item.frontImageFile,
          side: "front",
          sku,
        });
        const backImageUrl = await uploadDraftImage({
          supabase,
          storeId,
          accountId: ownerKey,
          file: persistentItemId
            ? persistentImages.backFile
            : item.backImageFile,
          side: "back",
          sku,
        });
        const promotedItem = await inventoryEngine.createSellerDraftProduct({
          sellerAccountId,
          title,
          description: buildDescription({
            title,
            ai: effectiveAi,
            scanId,
            searchQuery: effectiveSearchQuery,
            hasBackImage: effectiveHasBackImage,
          }),
          category: categoryFromAi(effectiveAi),
          condition: conditionFromAi(effectiveAi),
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

          let metadataQuery = supabase
            .from("inventory_items")
            .update({
              metadata: {
                authenticity,
                instacomp: {
                  source: "batch_scan",
                  persistentJobId,
                  persistentItemId,
                  dedupeKey: sku,
                  scanId,
                  clientId,
                  fileName: cleanText(item.fileName, 240),
                  backFileName,
                  hasBackImage: effectiveHasBackImage,
                  frontImageUrl,
                  backImageUrl,
                  searchQuery: effectiveSearchQuery,
                  ai: effectiveAi,
                  marketPrice,
                  listingPrice: price,
                  stats: effectiveStats,
                  soldStats: effectiveSoldStats,
                  sourceCoverage: effectiveSourceCoverage,
                  externalSearch: effectiveExternalSearch,
                  createdAt: new Date().toISOString(),
                },
              },
              notes:
                "InstaComp batch draft - verify photos, condition, pricing, shipping, and authenticity before activation.",
              updated_at: new Date().toISOString(),
            })
            .eq("id", promotedItem.inventoryItemId)
            .eq("store_id", storeId);
          metadataQuery = scopeSellerAccount(
            metadataQuery,
            sellerAccountId,
          );
          const { error: metadataError } = await metadataQuery;

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
        await markPersistentItemDrafted({
          supabase,
          storeId,
          sellerAccountId,
          jobId: persistentJobId,
          itemId: persistentItemId,
          inventoryItemId: promotedItem.inventoryItemId,
          reservationToken: draftReservationToken,
        });
        draftReservationToken = null;
        createdCount += 1;
      } catch (error: any) {
        let actualError = error;

        if (isMissingInventoryTables(error)) {
          await releasePersistentItemDraftReservation({
            supabase,
            itemId: persistentItemId,
            reservationToken: draftReservationToken,
          });
          return unavailableResponse();
        }

        if (error instanceof InventoryEngineError && error.statusCode === 409) {
          try {
            const existingDraft = await findExistingInstaCompDraft({
              supabase,
              storeId,
              sellerAccountId,
              sku,
              clientId: persistentItemId ? null : clientId,
              scanId: persistentItemId ? null : scanId,
            });

            if (existingDraft) {
              await markPersistentItemDrafted({
                supabase,
                storeId,
                sellerAccountId,
                jobId: persistentJobId,
                itemId: persistentItemId,
                inventoryItemId: existingDraft.id,
                reservationToken: draftReservationToken,
              });
              draftReservationToken = null;
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
          } catch (recoveryError: any) {
            actualError = recoveryError;
          }
        }

        await releasePersistentItemDraftReservation({
          supabase,
          itemId: persistentItemId,
          reservationToken: draftReservationToken,
        });

        if (actualError?.code === "INSTACOMP_JOB_MIGRATION_REQUIRED") {
          throw actualError;
        }

        errors.push({
          clientId,
          scanId,
          title,
          error: actualError.message || "Could not create draft listing.",
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

    if (
      error?.name === "InstaCompJobServerError" ||
      String(error?.code || "").startsWith("INSTACOMP_")
    ) {
      return instaCompJobErrorResponse(error);
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
