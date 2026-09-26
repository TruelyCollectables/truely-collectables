import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import {
  calculateCustomWebsitePricing,
  calculateDualMarketplacePricing,
  normalizeDualMarketplaceFeeProfile,
} from "../../../../../../lib/dual-marketplace-pricing";
import { createDualMarketplaceListingDraft } from "../../../../../../lib/dual-marketplace-listing";
import { assertSafeEbayListingContent } from "../../../../../../lib/ebay-listing-content";
import { effectiveInstaCompPricingGroupKey } from "../../../../../../lib/instacomp-pricing-group";
import { isInstaCompPublicationIdentityConfirmed } from "../../../../../../lib/instacomp-publication-identity";
import {
  classifyWebsiteProductIdentity,
  isSellableWebsiteProduct,
} from "../../../../../../lib/instacomp-current-website-inventory";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";
import { postInstaCompMacAccounting } from "../../../../../../lib/instacomp-mac-accounting-client";
import {
  assertKingmakerListingReadiness,
  buildKingmakerListingReadiness,
} from "../../../../../../lib/kingmaker-listing-readiness";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type UnknownRecord = Record<string, unknown>;
type ChannelAction = "save" | "publish-website" | "publish-ebay" | "publish-both" | "prepare-mercari" | "publish-mercari" | "publish-website-mercari" | "publish-all-3";

const OWNER_EMAILS = new Set([
  "sales@truelycollectables.com",
  "sales@trulycollectables.com",
]);

const RECEIVING_CUTOVER_MS = Date.parse("2026-09-16T00:00:00-06:00");

function isPreReceivingCutoverInventory(row: any) {
  const createdAt = Date.parse(String(row?.created_at || ""));
  return Number.isFinite(createdAt) && createdAt < RECEIVING_CUTOVER_MS;
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown, max = 500) {
  const result = String(value ?? "").trim();
  return result ? result.slice(0, max) : null;
}

function hasDurablePhysicalScanReceipt(row: any) {
  const metadata = record(row?.metadata);
  const lifecycle = record(metadata.inventory_lifecycle);
  const instacomp = record(metadata.instacomp);
  const scannerSource = text(instacomp.source);
  const physicalScannerSource =
    scannerSource === "kingmaker_exact_scan_intake_v2" ||
    scannerSource === "mac_registry_scanner";
  const completePair = Boolean(
    text(instacomp.imagePairSha256) &&
      text(instacomp.frontSha256) &&
      text(instacomp.backSha256) &&
      text(instacomp.frontSha256) !== text(instacomp.backSha256),
  );
  const persistedPair =
    instacomp.imagePersistenceVerified === true ||
    instacomp.imageOrientationPersisted === true;
  const lifecycleReceipt =
    text(lifecycle.state) === "received" ||
    Boolean(text(lifecycle.receivedAt));

  // A seller-created front/back KINGMAKER scan is the physical receipt event.
  // Identity, purchase matching, and pricing may still need review, but those
  // later workflows cannot turn an already scanned physical card back into
  // "not received."
  return Boolean(
    completePair &&
      physicalScannerSource &&
      (persistedPair || lifecycleReceipt),
  );
}

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed * 100) / 100
    : 0;
}

function wholeQuantity(value: unknown) {
  const parsed = Math.floor(Number(value || 0));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function envNumber(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  if (name.includes("PERCENT") && parsed >= 1 && parsed <= 100) return parsed / 100;
  return parsed;
}

function feeProfile() {
  return normalizeDualMarketplaceFeeProfile({
    ebayPercent: envNumber("TCOS_EBAY_FEE_PERCENT", 0.1325),
    ebayFixed: envNumber("TCOS_EBAY_FIXED_FEE", 0.4),
    ebayFixedUnderTen: envNumber("TCOS_EBAY_FIXED_FEE_UNDER_10", 0.3),
    promotedPercent: envNumber("TCOS_EBAY_PROMOTED_PERCENT", 0),
    websitePercent: envNumber("TCOS_WEBSITE_PROCESSING_PERCENT", 0.029),
    websiteFixed: envNumber("TCOS_WEBSITE_FIXED_FEE", 0.3),
    minimumWebsiteDiscountPercent: envNumber(
      "TCOS_MINIMUM_WEBSITE_DISCOUNT_PERCENT",
      0.03,
    ),
    websitePriceEnding: envNumber("TCOS_WEBSITE_PRICE_ENDING", 0.99),
  });
}

function uniquePhysical(metadataValue: unknown) {
  const metadata = record(metadataValue);
  const instaComp = record(metadata.instacomp);
  const asset = record(metadata.collectible_asset);
  const identity = record(
    instaComp.manualIdentityLocked === true
      ? instaComp.manualIdentity
      : instaComp.ai,
  );
  return Boolean(
    text(asset.exact_serial_number) ||
      text(asset.grading_cert_number) ||
      text(identity.serialNumber) ||
      text(identity.certificationNumber) ||
      text(identity.gradingCertNumber),
  );
}

function liveChannelRow(row: any) {
  const dual = record(record(row.metadata).dual_marketplace);
  const website = record(dual.website);
  const ebay = record(dual.ebay);
  const mercari = record(dual.mercari);
  return (
    row.status === "active" ||
    text(website.status) === "active" ||
    text(ebay.status) === "active" ||
    text(mercari.status) === "active"
  );
}

function generatedSku(row: any) {
  return (
    text(row.sku, 120) ||
    (row.legacy_product_id ? `TCOS-${row.legacy_product_id}` : null) ||
    `KM-${String(row.id).replace(/[^a-zA-Z0-9]/g, "").slice(0, 12).toUpperCase()}`
  );
}

async function archiveDuplicateDrafts(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  keeperId: string;
  rows: any[];
  groupKey: string | null;
  now: string;
}) {
  const duplicates = params.rows.filter(
    (row) => row.id !== params.keeperId && row.status === "draft",
  );
  for (const duplicate of duplicates) {
    const metadata = record(duplicate.metadata);
    const nextMetadata = {
      ...metadata,
      commercial_merge: {
        keeper_inventory_item_id: params.keeperId,
        pricing_group_key: params.groupKey,
        merged_quantity: wholeQuantity(duplicate.quantity),
        merged_at: params.now,
        reason: "exact_raw_card_consolidated_listing",
      },
    };
    const { error } = await params.supabase
      .from("inventory_items")
      .update({
        status: "archived",
        quantity: 0,
        metadata: nextMetadata,
        updated_at: params.now,
      })
      .eq("store_id", params.storeId)
      .eq("id", duplicate.id);
    if (error) throw error;

    if (duplicate.legacy_product_id) {
      const { error: productError } = await params.supabase
        .from("products")
        .update({ quantity: 0, archived_at: params.now })
        .eq("store_id", params.storeId)
        .eq("id", duplicate.legacy_product_id);
      if (productError) throw productError;
    }
  }
  return duplicates.length;
}

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });
    if (!OWNER_EMAILS.has(String(account.email || "").toLowerCase())) {
      return Response.json(
        { success: false, error: "eBay publishing readiness is limited to the store-owner account." },
        { status: 403 },
      );
    }
    const macEbay = await postInstaCompMacAccounting(
      "/v1/kingmaker/accounting/ebay-bridge",
      { mode: "readiness" },
      30_000,
    );
    const readiness = record(macEbay.readiness);
    return Response.json({
      success: true,
      ebay: {
        connected: readiness.connected === true,
        ready: readiness.ready === true,
        marketplaceId: text(readiness.marketplaceId, 40) || "EBAY_US",
        merchantLocationConfigured: Boolean(text(readiness.merchantLocationKey, 120)),
        fulfillmentPolicyConfigured: Boolean(text(readiness.fulfillmentPolicyId, 120)),
        paymentPolicyConfigured: Boolean(text(readiness.paymentPolicyId, 120)),
        returnPolicyConfigured: Boolean(text(readiness.returnPolicyId, 120)),
        missing: Array.isArray(readiness.missing) ? readiness.missing.map(String) : [],
        error: text(readiness.error, 1000),
        source: "mac_local_ebay_bridge",
      },
    });
  } catch (error) {
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : "Could not check eBay publishing readiness." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "save") as ChannelAction;
    if (!["save", "publish-website", "publish-ebay", "publish-both", "prepare-mercari", "publish-mercari", "publish-website-mercari", "publish-all-3"].includes(action)) {
      return Response.json({ success: false, error: "Unsupported channel action." }, { status: 400 });
    }
    const inventoryItemId = String(body.inventoryItemId || "").trim();
    if (!inventoryItemId) {
      return Response.json({ success: false, error: "Choose a KINGMAKER listing group." }, { status: 400 });
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isOwner = OWNER_EMAILS.has(String(account.email || "").toLowerCase());

    let requestedQuery = supabase
      .from("inventory_items")
      .select(
        "id,legacy_product_id,seller_account_id,sku,title,description,category,condition,status,quantity,price,metadata,created_at,updated_at",
      )
      .eq("store_id", storeId)
      .eq("id", inventoryItemId);
    requestedQuery = isOwner
      ? requestedQuery.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : requestedQuery.eq("seller_account_id", account.id);
    const { data: requested, error: requestedError } = await requestedQuery.maybeSingle();
    if (requestedError) throw requestedError;
    if (!requested) {
      return Response.json({ success: false, error: "Listing group not found or not owned." }, { status: 404 });
    }

    const requestedUnique = uniquePhysical(requested.metadata);
    const groupKey = requestedUnique
      ? null
      : effectiveInstaCompPricingGroupKey(requested.metadata);

    const ownedRows: any[] = [];
    const ownedPageSize = 1000;
    for (let offset = 0; ; offset += ownedPageSize) {
      let ownedQuery = supabase
        .from("inventory_items")
        .select(
          "id,legacy_product_id,seller_account_id,sku,title,description,category,condition,status,quantity,price,metadata,created_at,updated_at",
        )
        .eq("store_id", storeId);
      ownedQuery = isOwner
        ? ownedQuery.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
        : ownedQuery.eq("seller_account_id", account.id);
      const { data: ownedPage, error: ownedError } = await ownedQuery
        .order("id", { ascending: true })
        .range(offset, offset + ownedPageSize - 1);
      if (ownedError) throw ownedError;
      ownedRows.push(...(ownedPage || []));
      if (!ownedPage || ownedPage.length < ownedPageSize) break;
      if (ownedRows.length >= 20_000) {
        throw new Error("Inventory grouping exceeded the safe 20,000-row scan limit.");
      }
    }

    const groupRows = requestedUnique || !groupKey
      ? [requested]
      : ownedRows.filter((row) => {
          if (row.status === "archived" || row.status === "sold") return false;
          if (wholeQuantity(row.quantity) < 1) return false;
          if (uniquePhysical(row.metadata)) return false;
          return effectiveInstaCompPricingGroupKey(row.metadata) === groupKey;
        });
    if (!groupRows.some((row) => row.id === requested.id)) groupRows.unshift(requested);

    let physicalReadiness: any = null;
    if (action !== "save") {
      try {
        physicalReadiness = await postInstaCompMacAccounting(
          "/v1/kingmaker/accounting/listing-readiness",
          { inventory_item_ids: groupRows.map((row) => String(row.id)) },
          15_000,
        );
      } catch (error) {
        return Response.json(
          {
            success: false,
            code: "MAC_INVENTORY_LEDGER_UNAVAILABLE",
            error: `Listing blocked because the Mac-local physical inventory ledger could not be verified: ${error instanceof Error ? error.message : String(error)}`,
          },
          { status: 503 },
        );
      }
      if (physicalReadiness?.ready !== true) {
        const rawBlocked = Array.isArray(physicalReadiness?.blocked)
          ? physicalReadiness.blocked
          : [];
        const groupRowsById = new Map(
          groupRows.map((row) => [String(row.id), row]),
        );
        // The scan-gated Receiving contract begins with purchases/inventory
        // received on or after Sep 16, 2026. Older inventory was explicitly
        // grandfathered as already received during the backlog cutover. A
        // missing Mac receipt on one of those legacy rows must not invent a new
        // receiving requirement. If a legacy row *does* have a tracked receipt,
        // every real receipt state (pending, stash, etc.) still remains enforced.
        const blocked = rawBlocked.filter((row: any) => {
          if (row?.reason !== "physical_inventory_receipt_missing") return true;
          const inventory = groupRowsById.get(String(row?.inventoryItemId || ""));
          if (!inventory) return true;
          if (isPreReceivingCutoverInventory(inventory)) return false;
          return !hasDurablePhysicalScanReceipt(inventory);
        });
        if (blocked.length) {
          const reasons = blocked.map((row: any) => {
            const id = String(row?.inventoryItemId || "card").slice(0, 8);
            if (row?.reason === "investment_stash_not_for_sale") {
              return `${id} is in Investment Stash`;
            }
            if (row?.reason === "physical_inventory_receipt_missing") {
              return `${id} has no verified physical receipt`;
            }
            if (row?.reason === "matched_purchase_not_received_or_linked") {
              return `${id} has a matched purchase that has not been received`;
            }
            return `${id} is not ready to list (${String(row?.reason || "unknown_reason")})`;
          });
          return Response.json(
            {
              success: false,
              code: "PHYSICAL_INVENTORY_NOT_READY",
              error: `Physical inventory is not ready to list: ${reasons.join("; ")}`,
              blocked,
            },
            { status: 409 },
          );
        }
      }
    }

    const liveRows = groupRows.filter(liveChannelRow);
    if (
      action !== "save" &&
      liveRows.length === 1 &&
      liveRows[0].id !== requested.id
    ) {
      return Response.json(
        {
          success: false,
          code: "EXACT_DUPLICATE_MERGE_REQUIRED",
          error:
            "This exact card already has one live listing. Use KINGMAKER Merge first so quantity is reconciled without creating or silently revising a duplicate listing.",
          existingInventoryItemId: liveRows[0].id,
          requestedInventoryItemId: requested.id,
        },
        { status: 409 },
      );
    }
    if (liveRows.length > 1) {
      return Response.json(
        {
          success: false,
          error:
            "Multiple live listings already exist for this exact-card group. KINGMAKER stopped instead of creating another duplicate; reconcile the live duplicates first.",
          code: "MULTIPLE_LIVE_EXACT_CARD_LISTINGS",
          liveInventoryItemIds: liveRows.map((row) => row.id),
        },
        { status: 409 },
      );
    }

    const keeper = liveRows[0] || requested;
    if (!isInstaCompPublicationIdentityConfirmed(keeper.metadata)) {
      return Response.json(
        {
          success: false,
          error: "Human/operator identity confirmation is required before channel publishing.",
        },
        { status: 409 },
      );
    }

    const totalQuantity = groupRows.reduce(
      (sum, row) => sum + wholeQuantity(row.quantity),
      0,
    );
    if (totalQuantity < 1) {
      return Response.json({ success: false, error: "Group quantity is zero." }, { status: 409 });
    }

    let linkedProductId = keeper.legacy_product_id ? Number(keeper.legacy_product_id) : null;
    const { data: linkedProduct, error: linkedProductError } = linkedProductId
      ? await supabase
          .from("products")
          .select("id,sku,title,player,price,quantity,archived_at,listing_status,ebay_item_id")
          .eq("store_id", storeId)
          .eq("id", linkedProductId)
          .maybeSingle()
      : { data: null, error: null };
    if (linkedProductError) throw linkedProductError;

    const { data: images, error: imageError } = await supabase
      .from("inventory_images")
      .select("inventory_item_id,image_url,sort_order,is_primary")
      .in("inventory_item_id", [keeper.id, requested.id])
      .order("sort_order", { ascending: true });
    if (imageError) throw imageError;
    const imageUrls = Array.from(
      new Set(
        (images || [])
          .sort((a: any, b: any) => {
            const keeperA = a.inventory_item_id === keeper.id ? 0 : 1;
            const keeperB = b.inventory_item_id === keeper.id ? 0 : 1;
            return keeperA - keeperB || Number(a.sort_order || 0) - Number(b.sort_order || 0);
          })
          .map((image: any) => text(image.image_url, 2000))
          .filter((value): value is string => Boolean(value)),
      ),
    ).slice(0, 24);
    const metadata = record(keeper.metadata);
    const linkedWebsiteIdentity = linkedProduct
      ? classifyWebsiteProductIdentity({
          metadata,
          pendingTitle: keeper.title,
          product: linkedProduct,
        })
      : null;
    const instaComp = record(metadata.instacomp);
    const dual = record(metadata.dual_marketplace);
    const storedWebsite = record(dual.website);
    const storedEbay = record(dual.ebay);
    const storedMercari = record(dual.mercari);
    const generated = createDualMarketplaceListingDraft({
      title: String(keeper.title || "Trading Card"),
      description: keeper.description,
      category: keeper.category,
      condition: keeper.condition,
      metadata,
    });

    const requestedEbayPrice = money(body.ebayPrice) || money(storedEbay.price);
    const requestedWebsitePrice = money(body.websitePrice) || money(storedWebsite.price);
    const requestedMercariPrice = money(body.mercariPrice) || money(storedMercari.price);
    const basePrice =
      requestedEbayPrice ||
      requestedMercariPrice ||
      requestedWebsitePrice ||
      money(instaComp.listingPrice) ||
      money(instaComp.suggestedPrice) ||
      money(keeper.price);
    if (!basePrice) {
      return Response.json(
        { success: false, error: "Run InstaComp or choose a selling price before publishing." },
        { status: 409 },
      );
    }

    const fees = feeProfile();
    const automaticPricing = calculateDualMarketplacePricing(basePrice, fees);
    const ebayPrice = requestedEbayPrice || automaticPricing.ebayPrice;
    const websitePrice = requestedWebsitePrice || automaticPricing.websitePrice;
    const mercariPrice = requestedMercariPrice || ebayPrice;
    const pricing = calculateCustomWebsitePricing(ebayPrice, websitePrice, fees);
    const now = new Date().toISOString();
    const sku = text(keeper.sku, 120) || text(linkedProduct?.sku, 120) || generatedSku(keeper);
    const existingEbayListingId =
      text(storedEbay.listingId, 120) || text(linkedProduct?.ebay_item_id, 120);
    const needsNewEbayListing =
      (action === "publish-ebay" || action === "publish-both" || action === "publish-all-3") && !existingEbayListingId;
    const needsWebsitePublication = action === "publish-website" || action === "publish-both" || action === "publish-website-mercari" || action === "publish-all-3";
    if (
      needsWebsitePublication &&
      linkedProduct &&
      isSellableWebsiteProduct(linkedProduct) &&
      linkedWebsiteIdentity?.status !== "exact"
    ) {
      return Response.json(
        {
          success: false,
          code: "WEBSITE_LINK_IDENTITY_MISMATCH",
          error: `Website publishing blocked: linked live product ${linkedProduct.id} does not match this exact card (${linkedWebsiteIdentity?.reason || "identity could not be proven exact"}).`,
          linkedProductId: linkedProduct.id,
          linkedProductTitle: linkedProduct.title || null,
          matchStatus: linkedWebsiteIdentity?.status || "uncertain",
          matchReason: linkedWebsiteIdentity?.reason || null,
        },
        { status: 409 },
      );
    }
    if (imageUrls.length < 2 && (needsNewEbayListing || needsWebsitePublication || action === "publish-mercari")) {
      return Response.json(
        { success: false, error: "A stored front and back image are required before publishing a new channel listing." },
        { status: 409 },
      );
    }

    const websiteTitle = text(body.websiteTitle, 200) || text(storedWebsite.title, 200) || generated.websiteTitle;
    const websiteDescription =
      text(body.websiteDescription, 100_000) ||
      text(storedWebsite.description, 100_000) ||
      generated.websiteDescription;
    const ebayTitle = text(body.ebayTitle, 80) || text(storedEbay.title, 80) || generated.ebayTitle;
    const ebayDescription =
      text(body.ebayDescription, 100_000) ||
      text(storedEbay.description, 100_000) ||
      generated.ebayDescription;
    const cardCondition =
      text(body.cardCondition, 100) ||
      text(storedEbay.cardCondition, 100) ||
      generated.cardCondition ||
      (generated.grader ? "" : "Near Mint or Better");
    const bestOfferEnabled =
      body.bestOfferEnabled === true || storedEbay.bestOfferEnabled === true;

    const trackedPhysical = Array.isArray(physicalReadiness?.tracked)
      ? physicalReadiness.tracked
      : [];
    const trackedByInventoryId = new Map<string, any>(
      trackedPhysical.map((row: any) => [
        String(row?.inventoryItemId || ""),
        row,
      ]),
    );
    const acquisitionSources = groupRows.map((row) => {
      const rowMetadata = record(row.metadata);
      const rowInstaComp = record(rowMetadata.instacomp);
      const storedAcquisition = record(rowInstaComp.acquisition);
      return (
        text(trackedByInventoryId.get(String(row.id))?.source, 120) ||
        text(storedAcquisition.source, 120) ||
        "Misc"
      );
    });
    const acquisitionSource = Array.from(
      new Set(acquisitionSources),
    ).join(" + ");

    const listingReadiness = buildKingmakerListingReadiness({
      metadata,
      frontImageUrl: imageUrls[0] || null,
      backImageUrl: imageUrls[1] || null,
      condition: keeper.condition,
      quantity: totalQuantity,
      acquisitionSource,
      duplicateDecisionRequired: false,
      websitePrice,
      ebayPrice,
      mercariPrice,
      ebayCardCondition: cardCondition,
      graded: Boolean(generated.grader),
    });

    if (action !== "save") {
      if (action === "publish-website") {
        assertKingmakerListingReadiness(listingReadiness, "website");
      } else if (action === "publish-ebay") {
        assertKingmakerListingReadiness(listingReadiness, "ebay");
      } else if (action === "publish-mercari" || action === "prepare-mercari") {
        assertKingmakerListingReadiness(listingReadiness, "mercari");
      } else if (action === "publish-both") {
        assertKingmakerListingReadiness(listingReadiness, "website");
        assertKingmakerListingReadiness(listingReadiness, "ebay");
      } else if (action === "publish-website-mercari") {
        assertKingmakerListingReadiness(listingReadiness, "website");
        assertKingmakerListingReadiness(listingReadiness, "mercari");
      } else if (action === "publish-all-3") {
        assertKingmakerListingReadiness(listingReadiness, "all");
      }
    }

    const nextMetadata: UnknownRecord = {
      ...metadata,
      instacomp: {
        ...instaComp,
        pricingGroupKey: groupKey || effectiveInstaCompPricingGroupKey(metadata),
        commercialQuantity: totalQuantity,
        commercialKeeperInventoryItemId: keeper.id,
        acquisition: {
          ...record(instaComp.acquisition),
          source: acquisitionSource,
          trackedPhysicalCopies: trackedPhysical.map((row: any) => ({
            inventoryItemId: text(row?.inventoryItemId, 120),
            acquisitionItemId: Number(row?.acquisitionItemId || 0) || null,
            source: text(row?.source, 120),
            purchasedAt: text(row?.purchasedAt, 120),
            allocatedCost: Number(row?.allocatedCost || 0),
            costStatus: text(row?.costStatus, 40),
          })),
          updatedAt: now,
          authority: "mac_local_accounting",
        },
      },
      dual_marketplace: {
        ...dual,
        schema: "tcos.dualMarketplaceListing.v3",
        pricing: {
          ...pricing,
          feeProfile: fees,
          calculatedAt: now,
          source: body.manualChannelPrices === true ? "seller_manual_channel" : "kingmaker_pending",
          sellerPriceOverride: body.manualChannelPrices === true,
        },
        website: {
          ...storedWebsite,
          title: websiteTitle,
          description: websiteDescription,
          price: websitePrice,
          status: text(storedWebsite.status, 40) || "draft",
        },
        ebay: {
          ...storedEbay,
          title: ebayTitle,
          description: ebayDescription,
          price: ebayPrice,
          categoryId: text(body.ebayCategoryId, 40) || text(storedEbay.categoryId, 40) || generated.ebayCategoryId,
          condition: text(storedEbay.condition, 40) || generated.ebayCondition,
          cardCondition,
          grader: text(storedEbay.grader, 120) || generated.grader,
          grade: text(storedEbay.grade, 40) || generated.grade,
          certificationNumber:
            text(storedEbay.certificationNumber, 80) || generated.certificationNumber,
          aspects: Object.keys(record(storedEbay.aspects)).length
            ? record(storedEbay.aspects)
            : generated.aspects,
          bestOfferEnabled,
          status: text(storedEbay.status, 40) || "draft",
        },
        mercari: {
          ...storedMercari,
          price: mercariPrice,
          status: text(storedMercari.status, 40) || "draft",
          integrationMode: text(storedMercari.integrationMode, 80) || "chrome_logged_in_direct",
        },
        commercialGroup: {
          pricingGroupKey: groupKey,
          keeperInventoryItemId: keeper.id,
          memberInventoryItemIds: groupRows.map((row) => row.id),
          quantity: totalQuantity,
          updatedAt: now,
        },
        updatedAt: now,
      },
    };

    if ((action === "publish-website" || action === "publish-both" || action === "publish-website-mercari" || action === "publish-all-3") && !linkedProductId) {
      const { data: existingProducts, error: existingProductError } = await supabase
        .from("products")
        .select("id")
        .eq("store_id", storeId)
        .eq("sku", sku)
        .limit(2);
      if (existingProductError) throw existingProductError;
      if ((existingProducts || []).length > 1) {
        return Response.json(
          {
            success: false,
            error: "Multiple website product rows already use this KINGMAKER SKU. Publishing stopped to prevent duplicate inventory.",
            code: "MULTIPLE_WEBSITE_PRODUCTS_FOR_SKU",
            productIds: (existingProducts || []).map((row: any) => row.id),
          },
          { status: 409 },
        );
      }
      if ((existingProducts || []).length === 1) {
        linkedProductId = Number(existingProducts![0].id);
      } else {
        const { data: createdProduct, error: createProductError } = await supabase
          .from("products")
          .insert({
            store_id: storeId,
            seller_account_id: keeper.seller_account_id || account.id,
            sku,
            title: websiteTitle,
            description: websiteDescription,
            player: generated.identity.player,
            sport: generated.identity.sport,
            price: websitePrice,
            quantity: 0,
            image_url: imageUrls[0] || null,
            listing_status: "draft",
            archived_at: null,
          })
          .select("id")
          .single();
        if (createProductError || !createdProduct?.id) {
          throw createProductError || new Error("Could not create the linked website product record.");
        }
        linkedProductId = Number(createdProduct.id);
      }
    }

    const { error: keeperSaveError } = await supabase
      .from("inventory_items")
      .update({
        sku,
        quantity: totalQuantity,
        legacy_product_id: linkedProductId,
        metadata: nextMetadata,
        updated_at: now,
      })
      .eq("store_id", storeId)
      .eq("id", keeper.id);
    if (keeperSaveError) throw keeperSaveError;

    if (linkedProductId) {
      const { error: skuError } = await supabase
        .from("products")
        .update({ sku })
        .eq("store_id", storeId)
        .eq("id", linkedProductId);
      if (skuError) throw skuError;
    }

    let ebayResult: any = null;
    let ebayAttempt: any = null;
    let ebayVerification: any = null;
    let websitePublished = false;
    let websiteVerification: any = null;
    const mercariPrepared = false;
    let mercariPublished = false;
    let mercariResult: any = null;
    const errors: string[] = [];

    if (action === "prepare-mercari") {
      errors.push("Mercari now publishes directly from the logged-in Chrome seller session. Use List Mercari instead of the legacy prepare action.");
    }

    if (action === "publish-mercari" || action === "publish-website-mercari" || action === "publish-all-3") {
      const existingMercariStatus = text(storedMercari.status, 40)?.toLowerCase() || "";
      const existingMercariItemId = text(storedMercari.itemId, 120);
      if (existingMercariStatus === "active" && existingMercariItemId) {
        mercariResult = {
          itemId: existingMercariItemId,
          itemUrl: text(storedMercari.itemUrl, 1000) || `https://www.mercari.com/us/item/${existingMercariItemId}/`,
          account: text(storedMercari.account, 120),
          category: text(storedMercari.category, 120),
          reusedExistingListing: true,
        };
        mercariPublished = true;
      } else {
        try {
          const plainDescription = String(websiteDescription || generated.websiteDescription || "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 1000);
          const macMercari = await postInstaCompMacAccounting(
            "/v1/kingmaker/accounting/mercari-bridge",
            {
              mode: "publish",
              item: {
                inventoryItemId: keeper.id,
                title: String(requested.title || keeper.title || websiteTitle || ebayTitle || generated.websiteTitle || "Trading Card"),
                description: plainDescription || `Exact card shown in photos. ${String(keeper.title || "Trading card")}.`,
                price: mercariPrice,
                sport: generated.identity.sport,
                category: text(keeper.category, 240),
                imageUrls: imageUrls.slice(0, 12),
              },
            },
            240_000,
          );
          mercariResult = {
            itemId: text(macMercari.itemId, 120),
            itemUrl: text(macMercari.itemUrl, 1000),
            draftId: text(macMercari.draftId, 120),
            draftUrl: text(macMercari.draftUrl, 1000),
            account: text(macMercari.account, 120),
            category: text(macMercari.category, 120),
            reusedExistingListing: false,
          };
          if (!mercariResult.itemId || !mercariResult.itemUrl) {
            throw new Error("The Mac-local Mercari publisher did not return a live item ID and URL.");
          }
          const publishedAt = new Date().toISOString();
          const latestDual = record(nextMetadata.dual_marketplace);
          nextMetadata.dual_marketplace = {
            ...latestDual,
            mercari: {
              ...record(latestDual.mercari),
              price: mercariPrice,
              status: "active",
              integrationMode: "chrome_logged_in_direct",
              account: mercariResult.account,
              sport: generated.identity.sport,
              category: mercariResult.category,
              draftId: mercariResult.draftId,
              draftUrl: mercariResult.draftUrl,
              itemId: mercariResult.itemId,
              itemUrl: mercariResult.itemUrl,
              condition: "Like new",
              smartPricing: false,
              freeShipping: false,
              publishedAt,
              lastAttemptAt: publishedAt,
              lastError: null,
            },
          };
          await supabase
            .from("inventory_items")
            .update({ metadata: nextMetadata, updated_at: publishedAt })
            .eq("store_id", storeId)
            .eq("id", keeper.id)
            .throwOnError();
          mercariPublished = true;
        } catch (error) {
          const mercariError = error instanceof Error ? error.message : "Mercari publishing failed.";
          errors.push(mercariError);
          const attemptedAt = new Date().toISOString();
          const latestDual = record(nextMetadata.dual_marketplace);
          nextMetadata.dual_marketplace = {
            ...latestDual,
            mercari: {
              ...record(latestDual.mercari),
              status: "draft",
              integrationMode: "chrome_logged_in_direct",
              lastError: mercariError,
              lastAttemptAt: attemptedAt,
            },
          };
          await supabase
            .from("inventory_items")
            .update({ metadata: nextMetadata, updated_at: attemptedAt })
            .eq("store_id", storeId)
            .eq("id", keeper.id)
            .throwOnError();
        }
      }
    }

    if (action === "publish-ebay" || action === "publish-both" || action === "publish-all-3") {
      if (!isOwner) {
        errors.push("eBay publish from this KINGMAKER flow is currently limited to the store-owner account.");
      } else if (!existingEbayListingId && !cardCondition && generated.ebayCondition === "USED_VERY_GOOD") {
        errors.push("Review and save the raw card condition before publishing a new eBay listing.");
      } else {
        try {
          assertSafeEbayListingContent(ebayDescription || "");
          const ebayItem = {
            sku,
            title: ebayTitle || generated.ebayTitle,
            description: ebayDescription || generated.ebayDescription,
            quantity: totalQuantity,
            price: ebayPrice,
            imageUrls,
            aspects: record(record(nextMetadata.dual_marketplace).ebay).aspects as Record<string, string[]>,
            categoryId:
              text(record(record(nextMetadata.dual_marketplace).ebay).categoryId, 40) ||
              generated.ebayCategoryId,
            condition: generated.ebayCondition,
            cardCondition: cardCondition || "",
            grader: generated.grader,
            grade: generated.grade,
            certificationNumber: generated.certificationNumber,
            bestOfferEnabled,
          };
          const macEbay = existingEbayListingId
            ? await postInstaCompMacAccounting(
                "/v1/kingmaker/accounting/ebay-bridge",
                {
                  mode: "revise",
                  confirmation: "REVISE_LIVE",
                  revision: {
                    sku,
                    listingId: existingEbayListingId,
                    title: ebayTitle || generated.ebayTitle,
                    description: ebayDescription || generated.ebayDescription,
                    quantity: totalQuantity,
                    price: ebayPrice,
                  },
                },
                150_000,
              )
            : await postInstaCompMacAccounting(
                "/v1/kingmaker/accounting/ebay-bridge",
                { mode: "publish", confirmation: "PUBLISH_LIVE", item: ebayItem },
                150_000,
              );
          const pendingEbayResult = {
            listingId: String(macEbay.listingId || ""),
            offerId: String(macEbay.offerId || ""),
            createdOffer: existingEbayListingId ? false : macEbay.createdOffer === true,
            publishedOffer: existingEbayListingId ? false : macEbay.publishedOffer === true,
            revisedExisting: Boolean(existingEbayListingId),
            warnings: Array.isArray(macEbay.warnings) ? macEbay.warnings : [],
          };
          if (!pendingEbayResult.listingId || !pendingEbayResult.offerId) {
            throw new Error("The Mac-local eBay publisher did not return a listing ID and offer ID.");
          }
          ebayAttempt = pendingEbayResult;
          const verificationResponse = await postInstaCompMacAccounting(
            "/v1/kingmaker/accounting/ebay-bridge",
            {
              mode: "verify",
              verification: {
                listingId: pendingEbayResult.listingId,
                offerId: pendingEbayResult.offerId,
                sku,
                title: ebayItem.title,
                price: ebayPrice,
                quantity: totalQuantity,
                minimumImageCount: 2,
                imageUrls: imageUrls.slice(0, 12),
                condition: ebayItem.condition,
                cardCondition: cardCondition || null,
              },
            },
            60_000,
          );
          const verification = record(verificationResponse.verification);
          ebayVerification = verification;
          if (verification.verified !== true) {
            const failed = Array.isArray(verification.failed)
              ? verification.failed.map(String).join(", ")
              : "unknown verification failure";
            throw new Error(
              `eBay listing was created/revised but failed live read-back verification: ${failed}.`,
            );
          }
          ebayResult = {
            ...pendingEbayResult,
            verification,
          };
          const latestDual = record(nextMetadata.dual_marketplace);
          nextMetadata.dual_marketplace = {
            ...latestDual,
            ebay: {
              ...record(latestDual.ebay),
              status: "active",
              listingId: ebayResult.listingId,
              offerId: ebayResult.offerId,
              publishedAt: new Date().toISOString(),
              lastAttemptAt: new Date().toISOString(),
              warnings: ebayResult.warnings || [],
              verification: ebayResult.verification,
              verificationStatus: "verified",
              lastError: null,
            },
          };
          await supabase
            .from("inventory_items")
            .update({ metadata: nextMetadata, updated_at: new Date().toISOString() })
            .eq("store_id", storeId)
            .eq("id", keeper.id)
            .throwOnError();
          if (linkedProductId) {
            await supabase
              .from("products")
              .update({ ebay_item_id: ebayResult.listingId, last_seen_at: new Date().toISOString() })
              .eq("store_id", storeId)
              .eq("id", linkedProductId)
              .throwOnError();
          }
        } catch (error) {
          errors.push(error instanceof Error ? error.message : "eBay publishing failed.");
        }
      }
    }

    if ((action === "publish-ebay" || action === "publish-both" || action === "publish-all-3") && !ebayResult && errors.length) {
      const latestDual = record(nextMetadata.dual_marketplace);
      const ebayError = errors[errors.length - 1];
      nextMetadata.dual_marketplace = {
        ...latestDual,
        ebay: {
          ...record(latestDual.ebay),
          status: ebayAttempt?.listingId ? "verification_failed" : "draft",
          listingId:
            ebayAttempt?.listingId ||
            text(record(latestDual.ebay).listingId, 120) ||
            null,
          offerId:
            ebayAttempt?.offerId ||
            text(record(latestDual.ebay).offerId, 120) ||
            null,
          verification: ebayVerification,
          verificationStatus: ebayAttempt?.listingId
            ? "verification_failed"
            : "not_run",
          lastError: ebayError,
          lastAttemptAt: new Date().toISOString(),
        },
      };
      const failedAt = new Date().toISOString();
      await supabase
        .from("inventory_items")
        .update({ metadata: nextMetadata, updated_at: failedAt })
        .eq("store_id", storeId)
        .eq("id", keeper.id)
        .throwOnError();
      if (ebayAttempt?.listingId && linkedProductId) {
        await supabase
          .from("products")
          .update({
            ebay_item_id: ebayAttempt.listingId,
            last_seen_at: failedAt,
          })
          .eq("store_id", storeId)
          .eq("id", linkedProductId)
          .throwOnError();
      }
    }

    if (action === "publish-website" || action === "publish-both" || action === "publish-website-mercari" || action === "publish-all-3") {
      try {
        if (!linkedProductId) {
          throw new Error("Website product linkage could not be established.");
        }
        const attemptedAt = new Date().toISOString();
        const wasWebsiteLive =
          keeper.status === "active" &&
          linkedProduct != null &&
          isSellableWebsiteProduct(linkedProduct);
        const latestDual = record(nextMetadata.dual_marketplace);
        nextMetadata.dual_marketplace = {
          ...latestDual,
          website: {
            ...record(latestDual.website),
            status: "verification_pending",
            publishedAt: attemptedAt,
            lastAttemptAt: attemptedAt,
            lastError: null,
          },
        };

        const { error: inventoryError } = await supabase
          .from("inventory_items")
          .update({
            sku,
            title: websiteTitle,
            description: websiteDescription,
            status: "active",
            quantity: totalQuantity,
            price: websitePrice,
            metadata: nextMetadata,
            updated_at: attemptedAt,
          })
          .eq("store_id", storeId)
          .eq("id", keeper.id);
        if (inventoryError) throw inventoryError;

        const { error: productError } = await supabase
          .from("products")
          .update({
            sku,
            title: websiteTitle,
            description: websiteDescription,
            player: generated.identity.player,
            sport: generated.identity.sport,
            price: websitePrice,
            quantity: totalQuantity,
            image_url: imageUrls[0] || null,
            archived_at: null,
            listing_status: "live",
          })
          .eq("store_id", storeId)
          .eq("id", linkedProductId);
        if (productError) throw productError;

        const [inventoryRead, productRead, imageRead] = await Promise.all([
          supabase
            .from("inventory_items")
            .select("id,legacy_product_id,sku,title,status,quantity,price")
            .eq("store_id", storeId)
            .eq("id", keeper.id)
            .maybeSingle(),
          supabase
            .from("products")
            .select("id,sku,title,listing_status,quantity,price,image_url,archived_at")
            .eq("store_id", storeId)
            .eq("id", linkedProductId)
            .maybeSingle(),
          supabase
            .from("inventory_images")
            .select("image_url,sort_order,is_primary")
            .eq("inventory_item_id", keeper.id)
            .order("sort_order", { ascending: true }),
        ]);
        if (inventoryRead.error) throw inventoryRead.error;
        if (productRead.error) throw productRead.error;
        if (imageRead.error) throw imageRead.error;

        const liveInventory = inventoryRead.data;
        const liveProduct = productRead.data;
        const liveImages = Array.from(
          new Set(
            (imageRead.data || [])
              .map((row: any) => String(row.image_url || "").trim())
              .filter(Boolean),
          ),
        );
        const expectedImages = Array.from(
          new Set(imageUrls.slice(0, 2).map(String).filter(Boolean)),
        );
        const checks = {
          inventoryActive: liveInventory?.status === "active",
          productLinked:
            Number(liveInventory?.legacy_product_id || 0) === linkedProductId,
          sku:
            String(liveInventory?.sku || "") === sku &&
            String(liveProduct?.sku || "") === sku,
          title:
            String(liveInventory?.title || "").trim() === websiteTitle.trim() &&
            String(liveProduct?.title || "").trim() === websiteTitle.trim(),
          quantity:
            Number(liveInventory?.quantity || 0) === totalQuantity &&
            Number(liveProduct?.quantity || 0) === totalQuantity,
          price:
            Math.abs(Number(liveInventory?.price || 0) - websitePrice) < 0.011 &&
            Math.abs(Number(liveProduct?.price || 0) - websitePrice) < 0.011,
          productLive:
            liveProduct?.listing_status === "live" &&
            liveProduct?.archived_at == null,
          images:
            liveImages.length >= 2 &&
            expectedImages.every((url) => liveImages.includes(url)),
        };
        const failed = Object.entries(checks)
          .filter(([, passed]) => passed !== true)
          .map(([name]) => name);
        websiteVerification = {
          verified: failed.length === 0,
          checkedAt: new Date().toISOString(),
          source: "supabase_storefront_readback",
          productId: linkedProductId,
          inventoryItemId: keeper.id,
          imageCount: liveImages.length,
          checks,
          failed,
        };

        if (websiteVerification.verified !== true) {
          const failedMessage = failed.join(", ") || "unknown verification failure";
          const failureDual = record(nextMetadata.dual_marketplace);
          nextMetadata.dual_marketplace = {
            ...failureDual,
            website: {
              ...record(failureDual.website),
              status: "verification_failed",
              verificationStatus: "verification_failed",
              verification: websiteVerification,
              lastError: `Website read-back verification failed: ${failedMessage}.`,
              lastAttemptAt: new Date().toISOString(),
            },
          };
          await supabase
            .from("inventory_items")
            .update({
              status: wasWebsiteLive ? "active" : "draft",
              metadata: nextMetadata,
              updated_at: new Date().toISOString(),
            })
            .eq("store_id", storeId)
            .eq("id", keeper.id)
            .throwOnError();
          if (!wasWebsiteLive) {
            await supabase
              .from("products")
              .update({ quantity: 0, listing_status: "draft" })
              .eq("store_id", storeId)
              .eq("id", linkedProductId)
              .throwOnError();
          }
          throw new Error(
            `Website listing failed live read-back verification: ${failedMessage}.`,
          );
        }

        const verifiedDual = record(nextMetadata.dual_marketplace);
        nextMetadata.dual_marketplace = {
          ...verifiedDual,
          website: {
            ...record(verifiedDual.website),
            status: "active",
            verificationStatus: "verified",
            verification: websiteVerification,
            publishedAt: attemptedAt,
            lastAttemptAt: websiteVerification.checkedAt,
            lastError: null,
          },
        };
        await supabase
          .from("inventory_items")
          .update({
            metadata: nextMetadata,
            updated_at: websiteVerification.checkedAt,
          })
          .eq("store_id", storeId)
          .eq("id", keeper.id)
          .throwOnError();
        websitePublished = true;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Website publishing failed.");
      }
    }

    const anyPublished = websitePublished || Boolean(ebayResult) || mercariPrepared || mercariPublished;
    const archivedDuplicateCount = anyPublished
      ? await archiveDuplicateDrafts({
          supabase,
          storeId,
          keeperId: keeper.id,
          rows: groupRows,
          groupKey,
          now: new Date().toISOString(),
        })
      : 0;

    let masterProjectionSynced = false;
    let masterProjectionWarning: string | null = null;
    try {
      const projectionIds = Array.from(
        new Set(groupRows.map((row) => String(row.id)).filter(Boolean)),
      );
      for (let start = 0; start < projectionIds.length; start += 500) {
        const batchIds = projectionIds.slice(start, start + 500);
        const { data: projectionRows, error: projectionError } = await supabase
          .from("inventory_items")
          .select(
            "id,legacy_product_id,seller_account_id,card_uuid,sku,title,description,category,condition,status,quantity,price,metadata,created_at,updated_at",
          )
          .eq("store_id", storeId)
          .in("id", batchIds);
        if (projectionError) throw projectionError;
        await postInstaCompMacAccounting(
          "/v1/kingmaker/accounting/commercial-inventory",
          {
            action: "project_master",
            items: projectionRows || [],
          },
          15_000,
        );
      }
      masterProjectionSynced = true;
    } catch (error) {
      masterProjectionWarning =
        error instanceof Error
          ? error.message
          : "Mac Master Listings projection refresh failed.";
    }

    const success = errors.length === 0;
    return Response.json(
      {
        success,
        partial: !success && anyPublished,
        action,
        requestedInventoryItemId: requested.id,
        keeperInventoryItemId: keeper.id,
        groupKey,
        grouped: groupRows.length > 1,
        memberInventoryItemIds: groupRows.map((row) => row.id),
        quantity: totalQuantity,
        archivedDuplicateCount,
        masterProjectionSynced,
        masterProjectionWarning,
        suggestedPrice: money(instaComp.suggestedPrice) || null,
        ebayPrice,
        websitePrice,
        mercariPrice,
        cardCondition: cardCondition || null,
        ebayCategoryId: text(record(record(nextMetadata.dual_marketplace).ebay).categoryId, 40) || generated.ebayCategoryId,
        pricing,
        listingReadiness,
        websitePublished,
        websiteVerified: websiteVerification?.verified === true,
        websiteVerification,
        ebayPublished: Boolean(ebayResult),
        ebayVerified: ebayResult?.verification?.verified === true,
        ebayVerification:
          ebayResult?.verification || ebayVerification || null,
        ebayUpdated: ebayResult?.revisedExisting === true,
        ebayListingId: ebayResult?.listingId || null,
        ebayOfferId: ebayResult?.offerId || null,
        mercariPrepared,
        mercariPublished,
        mercariItemId: mercariResult?.itemId || null,
        mercariItemUrl: mercariResult?.itemUrl || null,
        mercariAccount: mercariResult?.account || null,
        mercariCategory: mercariResult?.category || text(record(record(nextMetadata.dual_marketplace).mercari).category, 120) || null,
        mercariImportMode: mercariPublished ? "chrome_logged_in_direct" : null,
        mercariSourceListingId: null,
        websiteProductId: linkedProductId,
        errors,
      },
      { status: success ? 200 : anyPublished ? 207 : 409 },
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "KINGMAKER channel action failed.",
      },
      { status: 500 },
    );
  }
}
