import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/account-auth";
import { getInventoryActivationBlockers } from "../../../../../lib/inventory-activation";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import {
  instaCompPricingGroupKey,
  summarizeInstaCompPricingGroup,
} from "../../../../../lib/instacomp-pricing-group";
import {
  instaCompPendingQueueFromMetadata,
  type InstaCompPendingQueue,
} from "../../../../../lib/instacomp-pending-queue";

export const dynamic = "force-dynamic";

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
  const candidate = identityValue(identity.player) || identityValue(identity.playerName);
  if (!candidate) return null;
  const normalized = candidate.toLowerCase();
  if (GENERIC_PLAYER_PHRASES.has(normalized)) return null;
  return candidate;
}

function buildIdentitySummary(identity: Record<string, unknown>) {
  const setName = textValue(identity.setName) || textValue(identity.set_name);
  const product = textValue(identity.product);
  const subset = identityValue(identity.subset);
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
  const manufacturer = identityValue(identity.manufacturer) || identityValue(identity.brand);
  const setName = identityValue(identity.setName) || identityValue(identity.set_name) || identityValue(identity.product);
  const subset = identityValue(identity.subset);
  const cardNumber = identityValue(identity.cardNumber) || identityValue(identity.card_number);
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
  const subset = identityValue(identity.subset);
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
    textValue(identity.parallel) || textValue(identity.checklistParallel) || textValue(identity.parallelName),
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
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
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
        sourceLabel: textValue(row.sourceLabel) || textValue(row.source) || "Source",
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
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
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
    const requestedQueue = new URL(request.url).searchParams.get("queue");
    const queue: InstaCompPendingQueue =
      requestedQueue === "verification" ? "verification" : "listings";
    const inventoryRows = await readOwnedInventoryPages({
      supabase,
      storeId,
      accountId: account.id,
      ownerAccount: isStoreOwnerAccount,
      columns: PENDING_INVENTORY_COLUMNS,
      draftOnly: false,
    });
    const instaCompRows = inventoryRows.filter((row: any) => {
      const metadata = recordValue(row.metadata);
      const instaComp = recordValue(metadata.instacomp);
      if (!Boolean(textValue(instaComp.source) || textValue(instaComp.scanId))) {
        return false;
      }
      return (
        instaComp.identityComplete === true ||
        textValue(instaComp.lastStatus) === "identity_complete" ||
        textValue(instaComp.lastStatus) === "review_required" ||
        textValue(instaComp.pricingStatus) === "identity_complete_pricing_pending"
      );
    });
    const queueCounts = {
      listings: instaCompRows.filter(
        (row: any) =>
          instaCompPendingQueueFromMetadata(row.metadata) === "listings",
      ).length,
      verification: instaCompRows.filter(
        (row: any) =>
          instaCompPendingQueueFromMetadata(row.metadata) === "verification",
      ).length,
    };
    const rows = instaCompRows.filter(
      (row: any) => instaCompPendingQueueFromMetadata(row.metadata) === queue,
    );

    const pricingGroupKeys = Array.from(
      new Set(
        rows
          .map((row: any) => instaCompPricingGroupKey(row.metadata))
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
      const key = instaCompPricingGroupKey(ownedRow.metadata);
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
          .filter((value: unknown): value is number => typeof value === "number"),
      ),
    );
    const { data: products, error: productError } =
      productIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("products")
            .select("id,card_uuid,image_url,price,quantity,archived_at")
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
      const collectibleAsset = recordValue(metadata.collectible_asset);
      const graderVerification = recordValue(metadata.grader_verification);
      const sellerReview = recordValue(metadata.seller_review);
      const sourceLinks = recordValue(instaComp.sourceLinks);
      const pricingAnalysis = recordValue(instaComp.pricingAnalysis);
      const pricingGroupKey = instaCompPricingGroupKey(metadata);
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
        buildIdentityTitle(ai) ||
        buildIdentityTitle(recordValue(metadata.card)) ||
        buildIdentityTitle(recordValue(metadata.verified_reference)) ||
        buildIdentityTitle(recordValue(metadata.collectible_asset)) ||
        buildIdentityTitle(metadata) ||
        null;
      const identitySummary =
        buildIdentitySummary(ai) ||
        buildIdentitySummary(recordValue(metadata.card)) ||
        buildIdentitySummary(recordValue(metadata.verified_reference)) ||
        buildIdentitySummary(recordValue(metadata.collectible_asset)) ||
        buildIdentitySummary(metadata) ||
        null;
      const identityReadout =
        buildIdentityReadout(ai) ||
        buildIdentityReadout(recordValue(metadata.card)) ||
        buildIdentityReadout(recordValue(metadata.verified_reference)) ||
        buildIdentityReadout(recordValue(metadata.collectible_asset)) ||
        buildIdentityReadout(metadata) ||
        null;
      const displayTitle =
        identityReadout ||
        identitySummary ||
        generatedTitle ||
        (rawTitle && !isGenericTitle(rawTitle) ? rawTitle : null) ||
        rawTitle ||
        "Untitled item";

      const suggestedPrice = optionalPrice(
        Object.prototype.hasOwnProperty.call(instaComp, "suggestedPrice")
          ? instaComp.suggestedPrice
          : instaComp.marketPrice,
      );
      const pricingStatus =
        textValue(instaComp.pricingStatus) ||
        (suggestedPrice === null
          ? "not_run"
          : suggestedPrice > 0
            ? "suggested_from_reliable_sold_comps"
            : "seller_price_required");

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
      const uniquePhysicalCopy = Boolean(exactSerialNumber || gradingCertNumber);

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
            sport: textValue(ai.sport),
            league: textValue(ai.league),
            year: textValue(ai.year),
            manufacturer:
              textValue(ai.manufacturer) || textValue(ai.brand),
            brand: textValue(ai.brand),
            product: textValue(ai.product),
            setName: textValue(ai.setName) || textValue(ai.set_name),
            subset: textValue(ai.subset),
            player: identityPlayerValue(ai),
            team: textValue(ai.team),
            cardNumber: textValue(ai.cardNumber) || textValue(ai.card_number),
            parallel:
              textValue(ai.checklistParallel) ||
              textValue(ai.parallelName) ||
              textValue(ai.parallel),
            variation: textValue(ai.variation),
            notes: textValue(ai.notes) || buildIdentitySummary(ai),
            serialNumber: textValue(ai.serialNumber) || exactSerialNumber,
            isRookie: ai.isRookie === true || collectibleAsset.rookie === true,
            isAuto: ai.isAuto === true || collectibleAsset.autograph === true,
            isRelic: ai.isRelic === true || collectibleAsset.memorabilia === true,
            inscription:
              ai.internalInscription === true || collectibleAsset.inscription === true,
            inscriptionText:
              textValue(ai.internalInscriptionText) ||
              textValue(collectibleAsset.inscription_text),
            memorabiliaType:
              textValue(ai.internalMemorabiliaType) ||
              textValue(collectibleAsset.memorabilia_type),
          },
          serialNumber: textValue(ai.serialNumber) || exactSerialNumber,
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
            textValue(instaComp.pricingReason) ||
            (pricingStatus === "not_run"
              ? "InstaComp pricing has not run yet."
              : pricingStatus === "seller_price_required"
                ? "No reliable sold comps were available. Seller sets the price."
                : "Reliable sold comps produced this suggestion."),
          reliableSoldCompCount: Math.max(
            0,
            Number(instaComp.reliableSoldCompCount || 0),
          ),
          pricingAnalysis: {
            strategy: textValue(pricingAnalysis.strategy) || "no_market",
            soldCount: Math.max(0, Number(pricingAnalysis.soldCount || 0)),
            activeCount: Math.max(0, Number(pricingAnalysis.activeCount || 0)),
            soldLow: optionalPrice(pricingAnalysis.soldLow),
            soldMedian: optionalPrice(pricingAnalysis.soldMedian),
            soldAverage: optionalPrice(pricingAnalysis.soldAverage),
            soldHigh: optionalPrice(pricingAnalysis.soldHigh),
            activeLow: optionalPrice(pricingAnalysis.activeLow),
            activeMedian: optionalPrice(pricingAnalysis.activeMedian),
            activeAverage: optionalPrice(pricingAnalysis.activeAverage),
            activeHigh: optionalPrice(pricingAnalysis.activeHigh),
            soldListTarget: optionalPrice(pricingAnalysis.soldListTarget),
            competitiveTarget: optionalPrice(pricingAnalysis.competitiveTarget),
          },
          pricingCheckedAt: textValue(instaComp.pricingCheckedAt),
          listingPrice: optionalPrice(instaComp.listingPrice),
          listingPriceSource: textValue(instaComp.listingPriceSource),
          soldCompEvidence: evidenceList(instaComp.soldCompEvidence),
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
            textValue(collectibleAsset.grading_grade) || textValue(ai.gradeValue),
          gradingCertNumber,
          graderVerificationStatus: effectiveGraderStatus(metadata),
          graderVerificationUrl:
            textValue(collectibleAsset.grader_verification_url) ||
            textValue(graderVerification.verificationUrl),
        },
      };
    });

    return Response.json(
      {
        items,
        count: items.length,
        queue,
        queueCounts,
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
