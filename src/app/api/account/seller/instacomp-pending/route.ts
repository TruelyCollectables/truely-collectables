import { readFileSync } from "node:fs";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/account-auth";
import { getInventoryActivationBlockers } from "../../../../../lib/inventory-activation";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import {
  effectiveInstaCompPricingGroupKey,
  summarizeInstaCompPricingGroup,
} from "../../../../../lib/instacomp-pricing-group";
import {
  instaCompPendingQueueFromMetadata,
  type InstaCompPendingQueue,
} from "../../../../../lib/instacomp-pending-queue";
import {
  calculateCustomWebsitePricing,
  calculateDualMarketplacePricing,
  normalizeDualMarketplaceFeeProfile,
} from "../../../../../lib/dual-marketplace-pricing";

export const dynamic = "force-dynamic";

type InstaCompListingFolder = "pending" | "website" | "ebay" | "both" | "investment";

const LOCAL_CERTIFIED_PRICING_PATH =
  process.env.INSTACOMP_CERTIFIED_PRICING_PATH ||
  "/Volumes/InstaCompAI/training/audits/km252-instacomp-final-v17-20260907.json";

type LocalCertifiedPricingRow = {
  n?: number;
  id?: string;
  identity?: Record<string, unknown>;
  status?: string;
  pricing?: Record<string, unknown>;
  exactSoldComps?: Array<Record<string, unknown>>;
  registryBound?: boolean;
};

function localPricingText(value: unknown) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function localPricingCardNumber(value: unknown) {
  return localPricingText(value).replace(/\s+/g, "");
}

function localPricingParallel(value: unknown) {
  return localPricingText(value)
    .replace(/\bprizms?\b/g, " ")
    .replace(/\bparallel\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadLocalCertifiedPricingRows(): LocalCertifiedPricingRow[] {
  try {
    const payload = JSON.parse(
      readFileSync(LOCAL_CERTIFIED_PRICING_PATH, "utf8"),
    );
    return Array.isArray(payload?.rows) ? payload.rows : [];
  } catch {
    return [];
  }
}

function localCertifiedPricingForIdentity(
  rows: LocalCertifiedPricingRow[],
  identity: Record<string, unknown>,
) {
  const year = localPricingText(identity.year);
  const player = localPricingText(identity.player || identity.playerName);
  const cardNumber = localPricingCardNumber(
    identity.cardNumber || identity.card_number,
  );
  const parallelRaw = localPricingText(
    identity.parallel ||
      identity.checklistParallel ||
      identity.parallelName ||
      identity.variation,
  );
  const parallel = localPricingParallel(parallelRaw);
  if (!year || !player || !cardNumber || !parallel) return null;

  const isAuto = identity.isAuto === true;
  const isRelic = identity.isRelic === true;
  const brand = localPricingText(identity.brand || identity.manufacturer);
  const product = localPricingText(
    identity.product || identity.setName || identity.set_name,
  );

  const candidates = rows
    .map((row) => {
      const candidate = recordValue(row.identity);
      if (localPricingText(candidate.year) !== year) return null;
      if (localPricingText(candidate.player || candidate.playerName) !== player)
        return null;
      if (
        localPricingCardNumber(
          candidate.cardNumber || candidate.card_number,
        ) !== cardNumber
      )
        return null;
      const candidateParallelRaw = localPricingText(
        candidate.parallel ||
          candidate.checklistParallel ||
          candidate.parallelName ||
          candidate.variation,
      );
      if (localPricingParallel(candidateParallelRaw) !== parallel) return null;
      if (
        (candidate.isAuto === true) !== isAuto ||
        (candidate.isRelic === true) !== isRelic
      )
        return null;

      let score = 100;
      if (candidateParallelRaw === parallelRaw) score += 40;
      const candidateBrand = localPricingText(
        candidate.brand || candidate.manufacturer,
      );
      const candidateProduct = localPricingText(
        candidate.product || candidate.setName || candidate.set_name,
      );
      if (
        brand &&
        candidateBrand &&
        (brand === candidateBrand ||
          brand.includes(candidateBrand) ||
          candidateBrand.includes(brand))
      )
        score += 10;
      if (
        product &&
        candidateProduct &&
        (product === candidateProduct ||
          product.includes(candidateProduct) ||
          candidateProduct.includes(product))
      )
        score += 8;
      if (row.registryBound === true) score += 2;
      score += Math.min(20, Number(recordValue(row.pricing).soldCount || 0));
      return { row, score };
    })
    .filter(
      (value): value is { row: LocalCertifiedPricingRow; score: number } =>
        Boolean(value),
    )
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.row || null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function listingFolderFromMetadata(
  metadataValue: unknown,
  legacyEbayLinked = false,
): InstaCompListingFolder {
  const metadata = recordValue(metadataValue);
  const lifecycle = recordValue(metadata.inventory_lifecycle);
  if (
    textValue(lifecycle.disposition) === "investment_stash" ||
    textValue(lifecycle.state) === "investment_stash"
  ) return "investment";
  const dual = recordValue(metadata.dual_marketplace);
  const websiteActive = textValue(recordValue(dual.website).status) === "active";
  const ebayActive =
    textValue(recordValue(dual.ebay).status) === "active" || legacyEbayLinked;
  if (websiteActive && ebayActive) return "both";
  if (websiteActive) return "website";
  if (ebayActive) return "ebay";
  return "pending";
}

function environmentNumber(name: string, fallback: number) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return raw >= 1 && raw <= 100 && name.includes("PERCENT") ? raw / 100 : raw;
}

function pendingChannelFeeProfile() {
  return normalizeDualMarketplaceFeeProfile({
    ebayPercent: environmentNumber("TCOS_EBAY_FEE_PERCENT", 0.1325),
    ebayFixed: environmentNumber("TCOS_EBAY_FIXED_FEE", 0.4),
    ebayFixedUnderTen: environmentNumber("TCOS_EBAY_FIXED_FEE_UNDER_10", 0.3),
    promotedPercent: environmentNumber("TCOS_EBAY_PROMOTED_PERCENT", 0),
    websitePercent: environmentNumber("TCOS_WEBSITE_PROCESSING_PERCENT", 0.029),
    websiteFixed: environmentNumber("TCOS_WEBSITE_FIXED_FEE", 0.3),
    minimumWebsiteDiscountPercent: environmentNumber(
      "TCOS_MINIMUM_WEBSITE_DISCOUNT_PERCENT",
      0.03,
    ),
    websitePriceEnding: environmentNumber("TCOS_WEBSITE_PRICE_ENDING", 0.99),
  });
}

function identityValue(value: unknown) {
  const text = textValue(value);
  if (!text) return null;
  const normalized = text.toLowerCase();
  if (
    normalized === "identity review required" ||
    normalized === "review required" ||
    normalized === "untitled item" ||
    normalized === "permanent uuid missing"
  ) {
    return null;
  }
  if (/^no\.?\s*/i.test(text) && text.split(/\s+/).length <= 3) {
    return null;
  }
  return text;
}

const GENERIC_PLAYER_PHRASES = new Set([
  "all american",
  "all-american",
  "crunch time",
  "crunch-time",
  "base",
  "chrome",
  "donruss",
  "heritage",
  "league leaders",
  "prizm",
  "prizms",
  "score",
  "select",
  "topps",
  "upper deck",
  "bowman",
  "rookie",
]);

function identityPlayerValue(identity: Record<string, unknown>) {
  const candidate =
    identityValue(identity.player) || identityValue(identity.playerName);
  if (!candidate) return null;
  const normalized = candidate.toLowerCase();
  if (GENERIC_PLAYER_PHRASES.has(normalized)) return null;
  return candidate;
}

function normalizeSubsetLabel(value: string) {
  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized === "all american" || normalized === "all-american")
    return "All American";
  if (normalized === "crunch time" || normalized === "crunch-time")
    return "Crunch Time";
  if (normalized === "future watch") return "Future Watch";
  if (normalized === "young guns") return "Young Guns";
  if (normalized === "spectrum fx") return "Spectrum FX";
  return value;
}

function identitySubsetValue(identity: Record<string, unknown>) {
  const candidate =
    identityValue(identity.subset) ||
    identityValue(identity.insertName) ||
    identityValue(identity.insert) ||
    identityValue(identity.seriesName) ||
    identityValue(identity.series) ||
    identityValue(identity.parallelName) ||
    identityValue(identity.parallel) ||
    identityValue(identity.player) ||
    identityValue(identity.playerName) ||
    identityValue(identity.subject);
  if (!candidate) return null;
  const normalized = candidate.toLowerCase();
  if (normalized === "base") return null;
  if (GENERIC_PLAYER_PHRASES.has(normalized))
    return normalizeSubsetLabel(candidate);
  return normalizeSubsetLabel(candidate);
}

function buildIdentitySummary(identity: Record<string, unknown>) {
  const setName = textValue(identity.setName) || textValue(identity.set_name);
  const product = textValue(identity.product);
  const subset = identitySubsetValue(identity);
  const brand = textValue(identity.brand) || textValue(identity.manufacturer);
  const player = identityPlayerValue(identity);
  const normalizedSetName = setName && /^base$/i.test(setName) ? null : setName;
  const pieces = [
    textValue(identity.year),
    brand,
    normalizedSetName || product,
    subset,
    textValue(identity.cardNumber) || textValue(identity.card_number)
      ? `#${textValue(identity.cardNumber) || textValue(identity.card_number)}`
      : null,
    player || textValue(identity.playerName),
    textValue(identity.team) ? `(${textValue(identity.team)})` : null,
  ].filter(Boolean);
  const surfaceVariation =
    textValue(identity.variation) ||
    textValue(identity.parallel) ||
    textValue(identity.checklistParallel) ||
    textValue(identity.parallelName);
  const summary = pieces.join(" ").replace(/\s+/g, " ").trim();
  return summary
    ? [
        `Card read: ${summary}.`,
        surfaceVariation ? `Surface variation: ${surfaceVariation}.` : null,
      ]
        .filter(Boolean)
        .join(" ")
    : null;
}

function buildIdentityReadout(identity: Record<string, unknown>) {
  const year = textValue(identity.year);
  const manufacturer =
    identityValue(identity.manufacturer) || identityValue(identity.brand);
  const setName =
    identityValue(identity.setName) ||
    identityValue(identity.set_name) ||
    identityValue(identity.product);
  const subset = identitySubsetValue(identity);
  const cardNumber =
    identityValue(identity.cardNumber) || identityValue(identity.card_number);
  const player = identityPlayerValue(identity);
  const team = identityValue(identity.team);
  const parallel =
    identityValue(identity.parallel) ||
    identityValue(identity.checklistParallel) ||
    identityValue(identity.parallelName) ||
    identityValue(identity.variation);
  const pieces = [
    year,
    manufacturer,
    setName,
    subset,
    cardNumber ? `#${cardNumber}` : null,
    player,
    team ? `(${team})` : null,
    parallel,
  ].filter(Boolean);
  return pieces.join(" ").replace(/\s+/g, " ").trim() || null;
}

function buildIdentityTitle(identity: Record<string, unknown>) {
  const setName = textValue(identity.setName) || textValue(identity.set_name);
  const product = textValue(identity.product);
  const subset = identitySubsetValue(identity);
  const brand = textValue(identity.brand) || textValue(identity.manufacturer);
  const player = identityPlayerValue(identity);
  const normalizedSetName = setName && /^base$/i.test(setName) ? null : setName;
  const pieces = [
    textValue(identity.year),
    brand,
    normalizedSetName || product,
    subset,
    textValue(identity.cardNumber) || textValue(identity.card_number)
      ? `#${textValue(identity.cardNumber) || textValue(identity.card_number)}`
      : null,
    player || textValue(identity.playerName),
    textValue(identity.parallel) ||
      textValue(identity.checklistParallel) ||
      textValue(identity.parallelName),
    textValue(identity.team) ? `(${textValue(identity.team)})` : null,
  ].filter(Boolean);
  return pieces.join(" ").replace(/\s+/g, " ").trim() || null;
}

function isGenericTitle(value: unknown) {
  const title = textValue(value)?.toLowerCase() || "";
  return (
    !title ||
    title === "untitled item" ||
    title === "identity review required" ||
    title === "review required" ||
    title.includes("identity review required") ||
    title.includes("review required") ||
    title.includes("credits") ||
    title.includes("permanent uuid missing")
  );
}

const PENDING_INVENTORY_COLUMNS =
  "id,legacy_product_id,seller_account_id,card_uuid,sku,title,description,category,condition,status,quantity,price,metadata,created_at,updated_at";

async function readOwnedInventoryPages(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  accountId: string;
  ownerAccount: boolean;
  columns: string;
  draftOnly?: boolean;
}) {
  const rows: any[] = [];

  for (let from = 0; ; from += 1000) {
    let query = params.supabase
      .from("inventory_items")
      .select(params.columns)
      .eq("store_id", params.storeId);

    if (params.draftOnly) query = query.eq("status", "draft");

    query = params.ownerAccount
      ? query.or(
          `seller_account_id.eq.${params.accountId},seller_account_id.is.null`,
        )
      : query.eq("seller_account_id", params.accountId);

    const { data, error } = await query
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + 999);

    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

function optionalPrice(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed * 100) / 100
    : null;
}

function evidenceList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
    )
    .map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        title: textValue(row.title) || "Untitled listing",
        price: optionalPrice(row.price) || 0,
        itemPrice: optionalPrice(row.itemPrice),
        shippingPrice: optionalPrice(row.shippingPrice),
        priceIncludesShipping: row.priceIncludesShipping === true,
        currency: textValue(row.currency) || "USD",
        url: textValue(row.url),
        imageUrl: textValue(row.imageUrl),
        source: textValue(row.source),
        sourceLabel:
          textValue(row.sourceLabel) || textValue(row.source) || "Source",
        sourceCategory: textValue(row.sourceCategory),
        matchScore:
          Number.isFinite(Number(row.matchScore)) && Number(row.matchScore) >= 0
            ? Number(row.matchScore)
            : null,
        flags: Array.isArray(row.flags)
          ? row.flags.map((flag) => String(flag)).slice(0, 20)
          : [],
        soldAt: textValue(row.soldAt),
        listedAt: textValue(row.listedAt),
        observedAt: textValue(row.observedAt),
      };
    })
    .filter((entry) => entry.url && entry.price > 0)
    .slice(0, 20);
}

function providerCoverageList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
    )
    .map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        source: textValue(row.source),
        label: textValue(row.label),
        status: textValue(row.status),
        resultCount: Math.max(0, Number(row.resultCount || 0)),
        message: textValue(row.message),
        searchUrl: textValue(row.searchUrl),
        queryAttempts: Array.isArray(row.queryAttempts)
          ? row.queryAttempts.map((query) => String(query)).slice(0, 10)
          : [],
      };
    });
}

function effectiveGraderStatus(metadata: Record<string, unknown>) {
  const instaComp = recordValue(metadata.instacomp);
  const collectibleAsset = recordValue(metadata.collectible_asset);
  const verifiedReference = recordValue(metadata.verified_reference);
  const stored = textValue(collectibleAsset.grader_verification_status);
  const company = textValue(collectibleAsset.grading_company);
  const certNumber = textValue(collectibleAsset.grading_cert_number);
  const humanVerifiedSlabEvidence =
    instaComp.humanVerified === true &&
    Boolean(company) &&
    Boolean(certNumber) &&
    Boolean(textValue(verifiedReference.front_sha256));

  if (stored === "conflict") return "conflict";
  if (stored === "verified" || stored === "manual_verified") return stored;
  if (humanVerifiedSlabEvidence) return "manual_verified";
  return stored || "pending";
}

type StoredImage = {
  inventory_item_id: string;
  image_url: string | null;
  alt_text: string | null;
  sort_order: number | null;
  is_primary: boolean | null;
};

function normalizedImages(rows: StoredImage[]) {
  return [...rows]
    .filter((row) => Boolean(textValue(row.image_url)))
    .sort((left, right) => {
      if (left.is_primary === true && right.is_primary !== true) return -1;
      if (right.is_primary === true && left.is_primary !== true) return 1;
      return Number(left.sort_order || 0) - Number(right.sort_order || 0);
    })
    .map((row) => ({
      url: textValue(row.image_url) as string,
      altText: textValue(row.alt_text),
      sortOrder: Number(row.sort_order || 0),
      isPrimary: row.is_primary === true,
    }));
}

function imagePairForItem(rows: StoredImage[]) {
  const images = normalizedImages(rows);
  const front =
    images.find((image) => image.isPrimary) ||
    images.find((image) => /\bfront\b/i.test(image.altText || "")) ||
    images[0] ||
    null;
  const back =
    images.find((image) => /\bback\b/i.test(image.altText || "")) ||
    images.find((image) => !image.isPrimary && image.url !== front?.url) ||
    images.find((image) => image.url !== front?.url) ||
    null;

  return {
    images,
    frontImageUrl: front?.url || null,
    backImageUrl: back?.url || null,
    hasStoredFrontImage: Boolean(front?.url),
    hasStoredBackImage: Boolean(back?.url),
    storedImageCount: images.length,
  };
}

export async function GET(request: Request) {
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

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isStoreOwnerAccount =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    const requestUrl = new URL(request.url);
    const requestedQueue = requestUrl.searchParams.get("queue");
    const requestedBatch = String(requestUrl.searchParams.get("batch") || "").trim();
    const requestedFolder = requestUrl.searchParams.get("folder");
    const queue: InstaCompPendingQueue =
      requestedQueue === "verification" ? "verification" : "listings";
    const folder: InstaCompListingFolder =
      requestedFolder === "website" ||
      requestedFolder === "ebay" ||
      requestedFolder === "both" ||
      requestedFolder === "investment"
        ? requestedFolder
        : "pending";
    const inventoryRows = await readOwnedInventoryPages({
      supabase,
      storeId,
      accountId: account.id,
      ownerAccount: isStoreOwnerAccount,
      columns: PENDING_INVENTORY_COLUMNS,
      draftOnly: false,
    });
    const instaCompRows = inventoryRows.filter((row: any) => {
      if (row.status === "archived" || row.status === "sold") return false;
      const metadata = recordValue(row.metadata);
      const instaComp = recordValue(metadata.instacomp);
      const cardIdentity = recordValue(metadata.card_identity);
      const saleIdentity = recordValue(metadata.sale_identity);
      const hasInstaCompSource = Boolean(
        textValue(instaComp.source) || textValue(instaComp.scanId),
      );
      const hasStoredIdentity = Boolean(
        textValue(cardIdentity.year) ||
        textValue(cardIdentity.player) ||
        textValue(cardIdentity.cardNumber) ||
        textValue(cardIdentity.card_number) ||
        textValue(saleIdentity.year) ||
        textValue(saleIdentity.player) ||
        textValue(saleIdentity.cardNumber) ||
        textValue(saleIdentity.card_number),
      );
      const queueHint =
        textValue(recordValue(metadata.listingWorkflow).queue) ||
        textValue(recordValue(metadata.listing_workflow).queue) ||
        textValue(recordValue(metadata.pending_verification).status);
      const hasStoredImageHint =
        textValue(
          instaComp.recoveredImageUrls &&
            (instaComp.recoveredImageUrls as Record<string, unknown>).front,
        ) ||
        textValue(
          instaComp.recoveredImageUrls &&
            (instaComp.recoveredImageUrls as Record<string, unknown>).back,
        ) ||
        (Array.isArray(instaComp.sourceImageUrls) &&
          instaComp.sourceImageUrls.some((value: unknown) =>
            Boolean(textValue(value)),
          ));
      if (
        !hasInstaCompSource &&
        !hasStoredIdentity &&
        !hasStoredImageHint &&
        queueHint !== "pending_verification" &&
        queueHint !== "pending"
      ) {
        return false;
      }
      if (
        queueHint === "pending_verification" ||
        queueHint === "pending" ||
        hasStoredImageHint ||
        hasStoredIdentity
      ) {
        return true;
      }
      return (
        instaComp.identityComplete === true ||
        textValue(instaComp.lastStatus) === "identity_complete" ||
        textValue(instaComp.lastStatus) === "review_required" ||
        textValue(instaComp.pricingStatus) ===
          "identity_complete_pricing_pending"
      );
    });
    const scopedInstaCompRows = requestedBatch
      ? instaCompRows.filter((row: any) => {
          const metadata = recordValue(row.metadata);
          const workflow = recordValue(metadata.listingWorkflow);
          const legacyWorkflow = recordValue(metadata.listing_workflow);
          const instaComp = recordValue(metadata.instacomp);
          return (
            textValue(workflow.reviewBatchId) === requestedBatch ||
            textValue(legacyWorkflow.reviewBatchId) === requestedBatch ||
            textValue(instaComp.kingmakerReviewBatchId) === requestedBatch
          );
        })
      : instaCompRows;

    const queueCounts = {
      listings: scopedInstaCompRows.filter(
        (row: any) =>
          instaCompPendingQueueFromMetadata(row.metadata) === "listings",
      ).length,
      verification: scopedInstaCompRows.filter(
        (row: any) =>
          instaCompPendingQueueFromMetadata(row.metadata) === "verification",
      ).length,
    };
    const listingRows = scopedInstaCompRows.filter(
      (row: any) => instaCompPendingQueueFromMetadata(row.metadata) === "listings",
    );
    const listingProductIds = Array.from(
      new Set(
        listingRows
          .map((row: any) => row.legacy_product_id)
          .filter((value: unknown): value is number => typeof value === "number"),
      ),
    );
    const { data: linkedEbayProducts, error: linkedEbayProductError } =
      listingProductIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("products")
            .select("id,ebay_item_id")
            .eq("store_id", storeId)
            .in("id", listingProductIds);
    if (linkedEbayProductError) throw linkedEbayProductError;
    const legacyEbayLinkedProductIds = new Set(
      (linkedEbayProducts || [])
        .filter((product: any) => Boolean(textValue(product.ebay_item_id)))
        .map((product: any) => Number(product.id)),
    );
    const rowHasLegacyEbayListing = (row: any) =>
      typeof row.legacy_product_id === "number" &&
      legacyEbayLinkedProductIds.has(Number(row.legacy_product_id));

    const folderCounts = {
      pending: listingRows.filter((row: any) => listingFolderFromMetadata(row.metadata, rowHasLegacyEbayListing(row)) === "pending").length,
      website: listingRows.filter((row: any) => listingFolderFromMetadata(row.metadata, rowHasLegacyEbayListing(row)) === "website").length,
      ebay: listingRows.filter((row: any) => listingFolderFromMetadata(row.metadata, rowHasLegacyEbayListing(row)) === "ebay").length,
      both: listingRows.filter((row: any) => listingFolderFromMetadata(row.metadata, rowHasLegacyEbayListing(row)) === "both").length,
      investment: listingRows.filter((row: any) => listingFolderFromMetadata(row.metadata, rowHasLegacyEbayListing(row)) === "investment").length,
    };
    const rows = scopedInstaCompRows.filter((row: any) => {
      const rowQueue = instaCompPendingQueueFromMetadata(row.metadata);
      if (rowQueue !== queue) return false;
      if (queue === "verification") return true;
      if (listingFolderFromMetadata(row.metadata, rowHasLegacyEbayListing(row)) !== folder) return false;
      const metadata = recordValue(row.metadata);
      const instaComp = recordValue(metadata.instacomp);
      return (
        instaComp.identityComplete === true ||
        textValue(instaComp.lastStatus) === "identity_complete" ||
        textValue(instaComp.lastStatus) === "review_required" ||
        textValue(instaComp.pricingStatus) ===
          "identity_complete_pricing_pending"
      );
    });

    const localCertifiedPricingRows = loadLocalCertifiedPricingRows();

    const pricingGroupKeys = Array.from(
      new Set(
        rows
          .map((row: any) => effectiveInstaCompPricingGroupKey(row.metadata))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const allOwnedRows =
      pricingGroupKeys.length > 0
        ? await readOwnedInventoryPages({
            supabase,
            storeId,
            accountId: account.id,
            ownerAccount: isStoreOwnerAccount,
            columns:
              "id,legacy_product_id,status,quantity,price,card_uuid,metadata,title,created_at",
          })
        : [];
    const pricingGroups = new Map<string, any[]>();
    for (const ownedRow of allOwnedRows || []) {
      const key = effectiveInstaCompPricingGroupKey(ownedRow.metadata);
      if (!key || !pricingGroupKeys.includes(key)) continue;
      const current = pricingGroups.get(key) || [];
      current.push(ownedRow);
      pricingGroups.set(key, current);
    }

    const itemIds = rows.map((row: any) => String(row.id));
    const { data: storedImages, error: imageError } =
      itemIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("inventory_images")
            .select(
              "inventory_item_id,image_url,alt_text,sort_order,is_primary",
            )
            .in("inventory_item_id", itemIds)
            .order("sort_order", { ascending: true });
    if (imageError) throw imageError;

    const imageRowsByItem = new Map<string, StoredImage[]>();
    for (const image of (storedImages || []) as StoredImage[]) {
      const key = String(image.inventory_item_id);
      const current = imageRowsByItem.get(key) || [];
      current.push(image);
      imageRowsByItem.set(key, current);
    }

    const productIds = Array.from(
      new Set(
        rows
          .map((row: any) => row.legacy_product_id)
          .filter(
            (value: unknown): value is number => typeof value === "number",
          ),
      ),
    );
    const { data: products, error: productError } =
      productIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("products")
            .select("id,card_uuid,image_url,price,quantity,archived_at,ebay_item_id")
            .eq("store_id", storeId)
            .in("id", productIds);
    if (productError) throw productError;

    const productMap = new Map(
      (products || []).map((product: any) => [product.id, product]),
    );

    const items = rows.map((row: any) => {
      const metadata = recordValue(row.metadata);
      const instaComp = recordValue(metadata.instacomp);
      const imageOrientation = recordValue(instaComp.imageOrientation);
      const ai = recordValue(instaComp.ai);
      const manualIdentity = recordValue(instaComp.manualIdentity);
      const manualIdentityLocked = instaComp.manualIdentityLocked === true;
      const primaryIdentity = manualIdentityLocked ? manualIdentity : ai;
      const localCertifiedPricing = manualIdentityLocked
        ? localCertifiedPricingForIdentity(
            localCertifiedPricingRows,
            primaryIdentity,
          )
        : null;
      const localCertifiedPricingAnalysis = recordValue(
        localCertifiedPricing?.pricing,
      );
      const collectibleAsset = recordValue(metadata.collectible_asset);
      const graderVerification = recordValue(metadata.grader_verification);
      const sellerReview = recordValue(metadata.seller_review);
      const sourceLinks = recordValue(instaComp.sourceLinks);
      const pricingAnalysis = recordValue(instaComp.pricingAnalysis);
      const dualMarketplace = recordValue(metadata.dual_marketplace);
      const dualWebsite = recordValue(dualMarketplace.website);
      const dualEbay = recordValue(dualMarketplace.ebay);
      const cardIdentity = recordValue(metadata.card_identity);
      const saleIdentity = recordValue(metadata.sale_identity);
      const pricingGroupKey = effectiveInstaCompPricingGroupKey(metadata);
      const pricingGroupRows = pricingGroupKey
        ? pricingGroups.get(pricingGroupKey) || []
        : [];
      const product = row.legacy_product_id
        ? productMap.get(row.legacy_product_id)
        : null;
      const storedPair = imagePairForItem(
        imageRowsByItem.get(String(row.id)) || [],
      );
      const metadataBackUrl =
        textValue(recordValue(instaComp.recoveredImageUrls).back) ||
        (Array.isArray(instaComp.sourceImageUrls)
          ? textValue(instaComp.sourceImageUrls[1])
          : null) ||
        (Array.isArray(metadata.ebay_image_urls)
          ? textValue(metadata.ebay_image_urls[1])
          : null);
      const hasBackImage =
        storedPair.hasStoredBackImage || Boolean(metadataBackUrl);
      const displayFrontUrl =
        storedPair.frontImageUrl || product?.image_url || null;
      const displayBackUrl = storedPair.backImageUrl || metadataBackUrl || null;
      const rawTitle = textValue(row.title);
      const generatedTitle =
        buildIdentityTitle(primaryIdentity) ||
        buildIdentityTitle(recordValue(metadata.card)) ||
        buildIdentityTitle(cardIdentity) ||
        buildIdentityTitle(saleIdentity) ||
        buildIdentityTitle(recordValue(metadata.verified_reference)) ||
        buildIdentityTitle(recordValue(metadata.collectible_asset)) ||
        buildIdentityTitle(metadata) ||
        null;
      const identitySummary =
        buildIdentitySummary(primaryIdentity) ||
        buildIdentitySummary(recordValue(metadata.card)) ||
        buildIdentitySummary(cardIdentity) ||
        buildIdentitySummary(saleIdentity) ||
        buildIdentitySummary(recordValue(metadata.verified_reference)) ||
        buildIdentitySummary(recordValue(metadata.collectible_asset)) ||
        buildIdentitySummary(metadata) ||
        null;
      const identityReadout =
        buildIdentityReadout(primaryIdentity) ||
        buildIdentityReadout(recordValue(metadata.card)) ||
        buildIdentityReadout(cardIdentity) ||
        buildIdentityReadout(saleIdentity) ||
        buildIdentityReadout(recordValue(metadata.verified_reference)) ||
        buildIdentityReadout(recordValue(metadata.collectible_asset)) ||
        buildIdentityReadout(metadata) ||
        null;
      const displayTitle = manualIdentityLocked
        ? rawTitle ||
          generatedTitle ||
          identityReadout ||
          identitySummary ||
          "Untitled item"
        : identityReadout ||
          identitySummary ||
          generatedTitle ||
          (rawTitle && !isGenericTitle(rawTitle) ? rawTitle : null) ||
          rawTitle ||
          "Untitled item";

      const suggestedPrice = optionalPrice(
        localCertifiedPricingAnalysis.instacomp ??
          localCertifiedPricingAnalysis.suggestedPrice ??
          (Object.prototype.hasOwnProperty.call(instaComp, "suggestedPrice")
            ? instaComp.suggestedPrice
            : instaComp.marketPrice),
      );
      const pricingStatus =
        (localCertifiedPricing && suggestedPrice !== null
          ? "suggested_from_local_certified_exact_sold_comps"
          : textValue(instaComp.pricingStatus)) ||
        (suggestedPrice === null
          ? "not_run"
          : suggestedPrice > 0
            ? "suggested_from_reliable_sold_comps"
            : "seller_price_required");
      const feeProfile = pendingChannelFeeProfile();
      const storedEbayPrice = optionalPrice(dualEbay.price);
      const storedWebsitePrice = optionalPrice(dualWebsite.price);
      const savedListingPrice = optionalPrice(instaComp.listingPrice);
      const savedListingPriceSource = textValue(instaComp.listingPriceSource);
      const channelAnchor =
        storedEbayPrice || savedListingPrice || suggestedPrice;
      const calculatedChannels = calculateDualMarketplacePricing(
        channelAnchor || 0,
        feeProfile,
      );
      const ebayChannelPrice = storedEbayPrice || calculatedChannels.ebayPrice || 0;
      const websiteChannelPrice =
        storedWebsitePrice || calculatedChannels.websitePrice || 0;
      const channelPricing = calculateCustomWebsitePricing(
        ebayChannelPrice,
        websiteChannelPrice,
        feeProfile,
      );

      const effectiveMetadata = hasBackImage
        ? {
            ...metadata,
            instacomp: {
              ...instaComp,
              hasBackImage: true,
              backSha256:
                textValue(instaComp.backSha256) || "stored-image-row-confirmed",
            },
          }
        : metadata;

      const blockers = getInventoryActivationBlockers({
        sku: row.sku || null,
        price: Number(row.price || 0),
        quantity: Number(row.quantity || 0),
        imageUrl: displayFrontUrl,
        title: row.title || null,
        category: row.category || null,
        metadata: effectiveMetadata,
      });
      const exactSerialNumber = textValue(collectibleAsset.exact_serial_number);
      const gradingCertNumber =
        textValue(collectibleAsset.grading_cert_number) ||
        textValue(ai.gradingCertNumber) ||
        textValue(ai.certificationNumber);
      const uniquePhysicalCopy = Boolean(
        exactSerialNumber || gradingCertNumber,
      );

      return {
        inventoryItemId: row.id,
        legacyProductId: row.legacy_product_id,
        title: displayTitle,
        description: row.description || null,
        sku: row.sku || null,
        status: row.status || "draft",
        quantity: Number(row.quantity || 0),
        price: Number(row.price || 0),
        imageUrl: displayFrontUrl,
        frontImageUrl: displayFrontUrl,
        backImageUrl: displayBackUrl,
        images: storedPair.images,
        storedImageCount: storedPair.storedImageCount,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        uniquePhysicalCopy,
        quantityRule: uniquePhysicalCopy
          ? "Serial-numbered and graded-cert copies stay quantity 1 so each physical asset keeps its own history."
          : "Additional identical raw, non-serialized copies may be merged into this quantity.",
        activationReadiness: {
          ready: blockers.length === 0,
          blockers,
        },
        sellerReview: {
          identityConfirmed: sellerReview.identity_confirmed === true,
          confirmedAt: textValue(sellerReview.confirmed_at),
          confirmedBy: textValue(sellerReview.confirmed_by),
        },
        inventoryLifecycle: {
          state: textValue(recordValue(metadata.inventory_lifecycle).state),
          disposition: textValue(recordValue(metadata.inventory_lifecycle).disposition),
          receivedAt: textValue(recordValue(metadata.inventory_lifecycle).receivedAt),
          scanId: textValue(recordValue(metadata.inventory_lifecycle).scanId),
        },
        instaComp: {
          source: textValue(instaComp.source),
          scanId: textValue(instaComp.scanId),
          humanVerified: instaComp.humanVerified === true,
          cardUuid:
            textValue(row.card_uuid) ||
            textValue(product?.card_uuid) ||
            textValue(instaComp.cardUuid) ||
            textValue(ai.internalCardUuid) ||
            null,
          pricingGroupKey,
          duplicateGroup: pricingGroupKey
            ? summarizeInstaCompPricingGroup(pricingGroupRows)
            : null,
          identity: {
            sport: textValue(primaryIdentity.sport),
            league: textValue(primaryIdentity.league),
            year: manualIdentityLocked
              ? textValue(primaryIdentity.year)
              : textValue(primaryIdentity.year) ||
                textValue(cardIdentity.year) ||
                textValue(saleIdentity.year),
            manufacturer: manualIdentityLocked
              ? textValue(primaryIdentity.manufacturer)
              : textValue(primaryIdentity.manufacturer) ||
                textValue(primaryIdentity.brand) ||
                textValue(cardIdentity.manufacturer) ||
                textValue(cardIdentity.brand) ||
                textValue(saleIdentity.manufacturer) ||
                textValue(saleIdentity.brand),
            brand: manualIdentityLocked
              ? textValue(primaryIdentity.brand)
              : textValue(primaryIdentity.brand) ||
                textValue(cardIdentity.brand) ||
                textValue(saleIdentity.brand),
            product: manualIdentityLocked
              ? textValue(primaryIdentity.product)
              : textValue(primaryIdentity.product) ||
                textValue(cardIdentity.product) ||
                textValue(saleIdentity.product),
            setName: manualIdentityLocked
              ? textValue(primaryIdentity.setName) ||
                textValue(primaryIdentity.set_name)
              : textValue(primaryIdentity.setName) ||
                textValue(primaryIdentity.set_name) ||
                textValue(cardIdentity.setName) ||
                textValue(cardIdentity.set_name) ||
                textValue(saleIdentity.setName) ||
                textValue(saleIdentity.set_name),
            subset: manualIdentityLocked
              ? identitySubsetValue(primaryIdentity)
              : identitySubsetValue(primaryIdentity) ||
                identitySubsetValue(recordValue(metadata.card)) ||
                identitySubsetValue(cardIdentity) ||
                identitySubsetValue(saleIdentity) ||
                identitySubsetValue(recordValue(metadata.verified_reference)),
            player: manualIdentityLocked
              ? identityPlayerValue(primaryIdentity)
              : identityPlayerValue(primaryIdentity) ||
                identityPlayerValue(cardIdentity) ||
                identityPlayerValue(saleIdentity),
            team: manualIdentityLocked
              ? textValue(primaryIdentity.team)
              : textValue(primaryIdentity.team) ||
                textValue(cardIdentity.team) ||
                textValue(saleIdentity.team),
            cardNumber: manualIdentityLocked
              ? textValue(primaryIdentity.cardNumber) ||
                textValue(primaryIdentity.card_number)
              : textValue(primaryIdentity.cardNumber) ||
                textValue(primaryIdentity.card_number) ||
                textValue(cardIdentity.cardNumber) ||
                textValue(cardIdentity.card_number) ||
                textValue(saleIdentity.cardNumber) ||
                textValue(saleIdentity.card_number),
            parallel: manualIdentityLocked
              ? textValue(primaryIdentity.parallel)
              : textValue(primaryIdentity.checklistParallel) ||
                textValue(primaryIdentity.parallelName) ||
                textValue(primaryIdentity.parallel) ||
                textValue(cardIdentity.parallel) ||
                textValue(saleIdentity.parallel),
            variation: manualIdentityLocked
              ? textValue(primaryIdentity.variation)
              : textValue(primaryIdentity.variation) ||
                textValue(cardIdentity.variation) ||
                textValue(saleIdentity.variation),
            notes:
              textValue(primaryIdentity.notes) ||
              buildIdentitySummary(ai) ||
              buildIdentitySummary(cardIdentity) ||
              buildIdentitySummary(saleIdentity),
            serialNumber: manualIdentityLocked
              ? textValue(primaryIdentity.serialNumber)
              : textValue(ai.serialNumber) ||
                textValue(cardIdentity.serialNumber) ||
                textValue(saleIdentity.serialNumber) ||
                exactSerialNumber,
            isRookie: manualIdentityLocked
              ? primaryIdentity.isRookie === true
              : ai.isRookie === true || collectibleAsset.rookie === true,
            isAuto: manualIdentityLocked
              ? primaryIdentity.isAuto === true
              : ai.isAuto === true || collectibleAsset.autograph === true,
            isRelic: manualIdentityLocked
              ? primaryIdentity.isRelic === true
              : ai.isRelic === true || collectibleAsset.memorabilia === true,
            inscription: manualIdentityLocked
              ? primaryIdentity.inscription === true
              : ai.internalInscription === true ||
                collectibleAsset.inscription === true,
            inscriptionText: manualIdentityLocked
              ? textValue(primaryIdentity.inscriptionText)
              : textValue(ai.internalInscriptionText) ||
                textValue(collectibleAsset.inscription_text),
            memorabiliaType: manualIdentityLocked
              ? textValue(primaryIdentity.memorabiliaType)
              : textValue(ai.internalMemorabiliaType) ||
                textValue(collectibleAsset.memorabilia_type),
          },
          serialNumber: manualIdentityLocked
            ? textValue(primaryIdentity.serialNumber)
            : textValue(ai.serialNumber) || exactSerialNumber,
          hasBackImage,
          imageOrientation: {
            verified:
              imageOrientation.status === "completed" &&
              instaComp.imageOrientationPersisted === true &&
              instaComp.imagePersistenceVerified === true,
            status: textValue(imageOrientation.status),
            source:
              textValue(imageOrientation.source) ||
              textValue(imageOrientation.model),
            frontRotation: Number(imageOrientation.frontRotation || 0),
            backRotation: Number(imageOrientation.backRotation || 0),
            reason: textValue(imageOrientation.reason),
          },
          backImageSource: storedPair.hasStoredBackImage
            ? "inventory_images"
            : metadataBackUrl
              ? "metadata_url"
              : "missing",
          suggestedPrice,
          pricingStatus,
          pricingReason:
            (localCertifiedPricing
              ? textValue(localCertifiedPricingAnalysis.explanation) ||
                "Local human-certified exact sold comps produced this suggestion."
              : null) ||
            textValue(instaComp.pricingReason) ||
            (pricingStatus === "not_run"
              ? "InstaComp pricing has not run yet."
              : pricingStatus === "seller_price_required"
                ? "No reliable sold comps were available. Seller sets the price."
                : "Reliable sold comps produced this suggestion."),
          reliableSoldCompCount: Math.max(
            0,
            Number(
              localCertifiedPricingAnalysis.soldCount ??
                instaComp.reliableSoldCompCount ??
                0,
            ),
          ),
          pricingAnalysis: {
            strategy:
              textValue(localCertifiedPricingAnalysis.strategy) ||
              textValue(pricingAnalysis.strategy) ||
              "no_market",
            soldCount: Math.max(
              0,
              Number(
                localCertifiedPricingAnalysis.soldCount ??
                  pricingAnalysis.soldCount ??
                  0,
              ),
            ),
            activeCount: Math.max(
              0,
              Number(
                localCertifiedPricingAnalysis.activeCount ??
                  pricingAnalysis.activeCount ??
                  0,
              ),
            ),
            soldLow: optionalPrice(
              localCertifiedPricingAnalysis.soldLow ?? pricingAnalysis.soldLow,
            ),
            soldMedian: optionalPrice(
              localCertifiedPricingAnalysis.soldMedian ??
                pricingAnalysis.soldMedian,
            ),
            soldAverage: optionalPrice(
              localCertifiedPricingAnalysis.soldAverage ??
                pricingAnalysis.soldAverage,
            ),
            soldHigh: optionalPrice(
              localCertifiedPricingAnalysis.soldHigh ??
                pricingAnalysis.soldHigh,
            ),
            activeLow: optionalPrice(
              localCertifiedPricingAnalysis.activeLow ??
                pricingAnalysis.activeLow,
            ),
            activeMedian: optionalPrice(
              localCertifiedPricingAnalysis.activeMedian ??
                pricingAnalysis.activeMedian,
            ),
            activeAverage: optionalPrice(
              localCertifiedPricingAnalysis.activeAverage ??
                pricingAnalysis.activeAverage,
            ),
            activeHigh: optionalPrice(
              localCertifiedPricingAnalysis.activeHigh ??
                pricingAnalysis.activeHigh,
            ),
            soldListTarget: optionalPrice(
              localCertifiedPricingAnalysis.soldListTarget ??
                pricingAnalysis.soldListTarget,
            ),
            competitiveTarget: optionalPrice(
              localCertifiedPricingAnalysis.competitiveTarget ??
                pricingAnalysis.competitiveTarget,
            ),
          },
          pricingCheckedAt: textValue(instaComp.pricingCheckedAt),
          listingPrice: optionalPrice(instaComp.listingPrice),
          listingPriceSource: textValue(instaComp.listingPriceSource),
          channelPricing: {
            ...channelPricing,
            websiteStatus: textValue(dualWebsite.status) || "draft",
            ebayStatus:
              textValue(dualEbay.status) ||
              (textValue(product?.ebay_item_id) ? "linked" : "draft"),
            calculatedFrom: storedEbayPrice
              ? "saved_ebay_price"
              : savedListingPrice
                ? savedListingPriceSource === "kingmaker_manual"
                  ? "seller_manual"
                  : "saved_listing_price"
                : suggestedPrice
                  ? "instacomp"
                  : "seller_price_required",
          },
          soldCompEvidence: localCertifiedPricing
            ? Array.isArray(localCertifiedPricing.exactSoldComps)
              ? localCertifiedPricing.exactSoldComps
                  .slice(0, 50)
                  .map((comp) => ({
                    title: textValue(comp.title),
                    price: optionalPrice(comp.price),
                    url: textValue(comp.url),
                    sourceLabel: "Local InstaComp certified exact sold",
                    soldAt: textValue(comp.soldAt),
                  }))
              : []
            : evidenceList(instaComp.soldCompEvidence),
          activeCompetition: evidenceList(instaComp.activeCompetition),
          rejectedCandidates: evidenceList(instaComp.rejectedCandidates),
          excludedCompEvidence: evidenceList(instaComp.excludedCompEvidence),
          excludedCompCount: Array.isArray(instaComp.excludedCompUrls)
            ? instaComp.excludedCompUrls.length
            : 0,
          providerCoverage: providerCoverageList(instaComp.providerCoverage),
          sourceLinks: {
            ebaySoldUrl: textValue(sourceLinks.ebaySoldUrl),
            ebayActiveUrl: textValue(sourceLinks.ebayActiveUrl),
            broadCardMarketUrl: textValue(sourceLinks.broadCardMarketUrl),
          },
          identitySummary,
          identityReadout,
          gradingCompany:
            textValue(collectibleAsset.grading_company) ||
            textValue(ai.gradingCompany),
          gradingGrade:
            textValue(collectibleAsset.grading_grade) ||
            textValue(ai.gradeValue),
          gradingCertNumber,
          graderVerificationStatus: effectiveGraderStatus(metadata),
          graderVerificationUrl:
            textValue(collectibleAsset.grader_verification_url) ||
            textValue(graderVerification.verificationUrl),
        },
      };
    });

    const commercialItems =
      queue === "listings"
        ? Array.from(
            items.reduce((groups, item) => {
              const groupKey =
                item.uniquePhysicalCopy !== true
                  ? item.instaComp.pricingGroupKey
                  : null;
              const key = groupKey || `physical:${item.inventoryItemId}`;
              const existing = groups.get(key);
              if (!existing) {
                groups.set(key, {
                  ...item,
                  commercialGroup: {
                    mergeable: Boolean(groupKey),
                    memberInventoryItemIds: [item.inventoryItemId],
                    members: [{
                      inventoryItemId: item.inventoryItemId,
                      scanId: item.instaComp.scanId || null,
                      cardUuid: item.instaComp.cardUuid || null,
                      identity: item.instaComp.identity || null,
                      frontImageUrl: item.frontImageUrl || null,
                      backImageUrl: item.backImageUrl || null,
                      inventoryLifecycle: item.inventoryLifecycle || null,
                    }],
                    pendingRows: 1,
                    pendingQuantity: Math.max(1, Number(item.quantity || 1)),
                    activeRows: Number(item.instaComp.duplicateGroup?.activeRows || 0),
                    totalQuantity: Number(
                      item.instaComp.duplicateGroup?.totalQuantity ||
                        item.quantity ||
                        1,
                    ),
                  },
                });
                return groups;
              }

              existing.commercialGroup.memberInventoryItemIds.push(
                item.inventoryItemId,
              );
              existing.commercialGroup.members.push({
                inventoryItemId: item.inventoryItemId,
                scanId: item.instaComp.scanId || null,
                cardUuid: item.instaComp.cardUuid || null,
                identity: item.instaComp.identity || null,
                frontImageUrl: item.frontImageUrl || null,
                backImageUrl: item.backImageUrl || null,
                inventoryLifecycle: item.inventoryLifecycle || null,
              });
              existing.commercialGroup.pendingRows += 1;
              existing.commercialGroup.pendingQuantity += Math.max(
                1,
                Number(item.quantity || 1),
              );
              existing.quantity = existing.commercialGroup.pendingQuantity;
              existing.activationReadiness = {
                ready:
                  existing.activationReadiness.ready &&
                  item.activationReadiness.ready,
                blockers: Array.from(
                  new Set([
                    ...existing.activationReadiness.blockers,
                    ...item.activationReadiness.blockers,
                  ]),
                ),
              };
              return groups;
            }, new Map<string, any>()),
          ).map(([, item]) => item)
        : items.map((item) => ({
            ...item,
            commercialGroup: {
              mergeable: false,
              memberInventoryItemIds: [item.inventoryItemId],
              members: [{
                inventoryItemId: item.inventoryItemId,
                scanId: item.instaComp.scanId || null,
                cardUuid: item.instaComp.cardUuid || null,
                identity: item.instaComp.identity || null,
                frontImageUrl: item.frontImageUrl || null,
                backImageUrl: item.backImageUrl || null,
                inventoryLifecycle: item.inventoryLifecycle || null,
              }],
              pendingRows: 1,
              pendingQuantity: Math.max(1, Number(item.quantity || 1)),
              activeRows: Number(item.instaComp.duplicateGroup?.activeRows || 0),
              totalQuantity: Number(
                item.instaComp.duplicateGroup?.totalQuantity || item.quantity || 1,
              ),
            },
          }));

    return Response.json(
      {
        items: commercialItems,
        count: commercialItems.length,
        physicalRowCount: items.length,
        queue,
        folder,
        queueCounts,
        folderCounts,
        imageAudit: {
          itemCount: items.length,
          withStoredBackImage: items.filter(
            (item) => item.instaComp.backImageSource === "inventory_images",
          ).length,
          withMetadataBackImage: items.filter(
            (item) => item.instaComp.backImageSource === "metadata_url",
          ).length,
          missingBackImage: items.filter(
            (item) => item.instaComp.hasBackImage !== true,
          ).length,
        },
        pricingRule: {
          reliableSoldComps:
            "Exact sold comps establish market value. Exact active listings establish current competition. InstaComp combines both into a transparent sweet-spot listing suggestion.",
          noReliableSoldComps:
            "$0.00 means no reliable sold comps passed; seller pricing is required.",
          activeCompetition:
            "Active listings are shown separately and also constrain the sweet-spot listing target without replacing sold-market evidence.",
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    return Response.json(
      { error: error?.message || "Could not load InstaComp pending listings." },
      { status: 500 },
    );
  }
}
