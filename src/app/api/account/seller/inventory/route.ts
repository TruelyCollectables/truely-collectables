import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/account-auth";
import {
  extractAuthenticityProfile,
  type AuthenticityProfile,
} from "../../../../../lib/authenticity";
import {
  getInventoryActivationBlockers,
  type InventoryActivationBlocker,
} from "../../../../../lib/inventory-activation";
import {
  calculateShipping,
  getUnder20SellerProtection,
  getUnder20SellerProtectionOptIn,
  getShippingCoverage,
  resolveShippingMethod,
  SHIPPING_RULES,
  STANDARD_ENVELOPE_MAX_SUBTOTAL,
  type ShippingMethod,
} from "../../../../../lib/shipping";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type InventoryRow = {
  id: string;
  legacy_product_id: number | null;
  seller_account_id: string | null;
  sku: string | null;
  title: string | null;
  description: string | null;
  category: string | null;
  condition: string | null;
  status: string | null;
  quantity: number | null;
  price: number | string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
  created_at: string | null;
};

type ProductRow = {
  id: number;
  ebay_item_id: string | null;
  image_url: string | null;
};

type SellerInventoryResponseItem = {
  inventoryItemId: string;
  legacyProductId: number | null;
  ownershipScope: "seller" | "store";
  title: string;
  description: string | null;
  sku: string | null;
  category: string;
  condition: string;
  status: string;
  quantity: number;
  price: number;
  updatedAt: string | null;
  createdAt: string | null;
  ebayItemId: string | null;
  imageUrl: string | null;
  authenticity: AuthenticityProfile;
  shippingPlan: {
    method: ShippingMethod;
    label: string;
    estimatedOunces: number;
    postageEstimate: number;
    coverageProvider: string;
    coverageRequired: boolean;
    coverageType: string;
    sellerProtectionOptedIn: boolean;
    sellerProtectionProvider: string;
    sellerProtectionRate: number;
    sellerProtectionMaxCoverage: number;
    sellerProtectionFeeEstimate: number;
    sellerProtectionCoveredAmount: number;
    sellerProtectionCoverageBasis: string;
    sellerProtectionClaimRule: string;
    sellerProtectionRefundRule: string;
    sellerProtectionReimbursesShipping: boolean;
    sellerProtectionLegalLabel: string;
    reason: string | null;
  };
  instaComp: {
    isInstaCompDraft: boolean;
    source: string | null;
    scanId: string | null;
    serialNumber: string | null;
    marketPrice: number | null;
    listingPrice: number | null;
    listingPriceSource: string | null;
    hasBackImage: boolean;
  };
  activationReadiness: {
    ready: boolean;
    blockers: InventoryActivationBlocker[];
  };
};

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function moneyNumber(value: number | string | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableMoneyNumber(value: unknown) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed * 100) / 100
    : null;
}

function instacompSummary(metadata: Record<string, unknown> | null) {
  const instacomp = recordValue(recordValue(metadata).instacomp);
  const ai = recordValue(instacomp.ai);
  const source = textValue(instacomp.source);
  const scanId = textValue(instacomp.scanId);

  return {
    isInstaCompDraft: Boolean(source || scanId),
    source,
    scanId,
    serialNumber: textValue(ai.serialNumber),
    marketPrice: nullableMoneyNumber(instacomp.marketPrice),
    listingPrice: nullableMoneyNumber(instacomp.listingPrice),
    listingPriceSource: textValue(instacomp.listingPriceSource),
    hasBackImage: Boolean(instacomp.hasBackImage),
  };
}

function sellerInventoryShippingPlan(
  price: number,
  metadata: Record<string, unknown> | null,
) {
  const subtotal = Math.max(0, Math.round(Number(price || 0) * 100) / 100);
  const itemCount = 1;
  const requestedMethod: ShippingMethod =
    subtotal > STANDARD_ENVELOPE_MAX_SUBTOTAL
      ? "GROUND_ADVANTAGE"
      : "STANDARD_ENVELOPE";
  const resolved = resolveShippingMethod({
    requestedMethod,
    itemCount,
    subtotal,
  });
  const coverage = getShippingCoverage({
    method: resolved.method,
    subtotal,
  });
  const sellerProtectionOptedIn = getUnder20SellerProtectionOptIn(metadata);
  const sellerProtection = getUnder20SellerProtection({
    method: resolved.method,
    subtotal,
    sellerOptedIn: sellerProtectionOptedIn,
  });

  return {
    method: resolved.method,
    label: SHIPPING_RULES[resolved.method].shortName,
    estimatedOunces: resolved.standardEnvelope.estimatedOunces,
    postageEstimate: calculateShipping({
      itemCount,
      subtotal,
      method: resolved.method,
    }),
    coverageProvider: coverage.provider,
    coverageRequired: coverage.required,
    coverageType: coverage.coverageType,
    sellerProtectionOptedIn,
    sellerProtectionProvider: sellerProtection.provider,
    sellerProtectionRate: sellerProtection.rate,
    sellerProtectionMaxCoverage: sellerProtection.maxCoverage,
    sellerProtectionFeeEstimate: sellerProtection.feeAmount,
    sellerProtectionCoveredAmount: sellerProtection.coveredAmount,
    sellerProtectionCoverageBasis: sellerProtection.coverageBasis,
    sellerProtectionClaimRule: sellerProtection.claimTrigger,
    sellerProtectionRefundRule: sellerProtection.sellerRefundRule,
    sellerProtectionReimbursesShipping: sellerProtection.reimbursesShipping,
    sellerProtectionLegalLabel: sellerProtection.legalLabel,
    reason: resolved.reason,
  };
}

function isMissingSellerInventoryTables(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("inventory_items") ||
    message.includes("products")
  );
}

function mapInventoryItem(
  item: InventoryRow,
  productsById: Map<number, ProductRow>,
  accountId: string,
): SellerInventoryResponseItem {
  const product = item.legacy_product_id
    ? productsById.get(item.legacy_product_id)
    : null;
  const shouldEvaluateReadiness = ["draft", "archived"].includes(
    item.status || "draft",
  );
  const blockers =
    shouldEvaluateReadiness
      ? getInventoryActivationBlockers({
          sku: item.sku,
          price: moneyNumber(item.price),
          quantity: Number(item.quantity || 0),
          imageUrl: product?.image_url || null,
          title: item.title,
          category: item.category,
          metadata: item.metadata,
        })
      : [];

  return {
    inventoryItemId: item.id,
    legacyProductId: item.legacy_product_id,
    ownershipScope: item.seller_account_id === accountId ? "seller" : "store",
    title: item.title || "Untitled item",
    description: item.description || null,
    sku: item.sku || null,
    category: item.category || "other_collectable",
    condition: item.condition || "unknown",
    status: item.status || "draft",
    quantity: Number(item.quantity || 0),
    price: moneyNumber(item.price),
    updatedAt: item.updated_at,
    createdAt: item.created_at,
    ebayItemId: product?.ebay_item_id || null,
    imageUrl: product?.image_url || null,
    authenticity: extractAuthenticityProfile(item.metadata),
    shippingPlan: sellerInventoryShippingPlan(
      moneyNumber(item.price),
      item.metadata,
    ),
    instaComp: instacompSummary(item.metadata),
    activationReadiness: {
      ready: shouldEvaluateReadiness
        ? blockers.length === 0
        : item.status === "active",
      blockers,
    },
  };
}

function sellerInventoryHeaders(params: {
  totalItems: number;
  draftCount: number;
  draftReadyCount: number;
  draftNeedsWorkCount: number;
  activeCount: number;
  archivedCount: number;
  storeOwnedCount: number;
  instacompDraftCount: number;
  instacompReadyDraftCount: number;
  standardEnvelopeCount: number;
  sellerProtectionOptInCount: number;
}) {
  return {
    "X-TCOS-Seller-Inventory-Items": String(params.totalItems),
    "X-TCOS-Seller-Inventory-Drafts": String(params.draftCount),
    "X-TCOS-Seller-Inventory-Draft-Ready": String(params.draftReadyCount),
    "X-TCOS-Seller-Inventory-Draft-Needs-Work": String(
      params.draftNeedsWorkCount,
    ),
    "X-TCOS-Seller-Inventory-Active": String(params.activeCount),
    "X-TCOS-Seller-Inventory-Archived": String(params.archivedCount),
    "X-TCOS-Seller-Inventory-Store-Owned": String(params.storeOwnedCount),
    "X-TCOS-Seller-Inventory-InstaComp-Drafts": String(
      params.instacompDraftCount,
    ),
    "X-TCOS-Seller-Inventory-InstaComp-Ready": String(
      params.instacompReadyDraftCount,
    ),
    "X-TCOS-Seller-Inventory-Standard-Envelope": String(
      params.standardEnvelopeCount,
    ),
    "X-TCOS-Seller-Inventory-Protection-Opt-In": String(
      params.sellerProtectionOptInCount,
    ),
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

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const isStoreOwnerAccount =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    let inventoryQuery = supabase
      .from("inventory_items")
      .select(
        "id,legacy_product_id,seller_account_id,sku,title,description,category,condition,status,quantity,price,metadata,updated_at,created_at",
      )
      .eq("store_id", storeId)
      .order("updated_at", { ascending: false });

    inventoryQuery = isStoreOwnerAccount
      ? inventoryQuery.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : inventoryQuery.eq("seller_account_id", account.id);

    const { data: inventoryData, error: inventoryError } = await inventoryQuery;

    if (inventoryError) {
      if (isMissingSellerInventoryTables(inventoryError)) {
        return Response.json(
          {
            error:
              "Seller inventory is not available until the inventory migrations are applied.",
          },
          { status: 503 },
        );
      }

      throw inventoryError;
    }

    const inventoryItems = (inventoryData || []) as InventoryRow[];
    const legacyProductIds = Array.from(
      new Set(
        inventoryItems
          .map((item) => item.legacy_product_id)
          .filter(
            (value): value is number =>
              typeof value === "number" &&
              Number.isInteger(value) &&
              value > 0,
          ),
      ),
    );
    const { data: productData, error: productError } =
      legacyProductIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("products")
            .select("id,ebay_item_id,image_url")
            .eq("store_id", storeId)
            .in("id", legacyProductIds);

    if (productError) {
      if (isMissingSellerInventoryTables(productError)) {
        return Response.json(
          {
            error:
              "Seller inventory is not available until the inventory migrations are applied.",
          },
          { status: 503 },
        );
      }

      throw productError;
    }

    const productsById = new Map(
      ((productData || []) as ProductRow[]).map((row) => [row.id, row]),
    );
    const items = inventoryItems.map((item) =>
      mapInventoryItem(item, productsById, account.id),
    );
    const recentItems = items.slice(0, 12);
    const totalQuantity = inventoryItems.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0,
    );
    const totalDraftValue = inventoryItems
      .filter((item) => item.status === "draft")
      .reduce(
        (sum, item) => sum + moneyNumber(item.price) * Number(item.quantity || 0),
        0,
      );
    const instacompDraftCount = inventoryItems.filter((item) => {
      const instaComp = instacompSummary(item.metadata);

      return item.status === "draft" && instaComp.isInstaCompDraft;
    }).length;
    const instacompReadyDraftCount = inventoryItems.filter((item) => {
      if (item.status !== "draft") return false;

      const instaComp = instacompSummary(item.metadata);

      if (!instaComp.isInstaCompDraft) return false;

      const product = item.legacy_product_id
        ? productsById.get(item.legacy_product_id)
        : null;

      return (
        getInventoryActivationBlockers({
          title: item.title,
          category: item.category,
          sku: item.sku,
          price: moneyNumber(item.price),
          quantity: Number(item.quantity || 0),
          imageUrl: product?.image_url || null,
          metadata: item.metadata,
        }).length === 0
      );
    }).length;
    const draftReadyCount = inventoryItems.filter((item) => {
      if (item.status !== "draft") return false;

      const product = item.legacy_product_id
        ? productsById.get(item.legacy_product_id)
        : null;

      return (
        getInventoryActivationBlockers({
          title: item.title,
          category: item.category,
          sku: item.sku,
          price: moneyNumber(item.price),
          quantity: Number(item.quantity || 0),
          imageUrl: product?.image_url || null,
          metadata: item.metadata,
        }).length === 0
      );
    }).length;
    const draftNeedsWorkCount = inventoryItems.filter((item) => {
      if (item.status !== "draft") return false;

      const product = item.legacy_product_id
        ? productsById.get(item.legacy_product_id)
        : null;

      return (
        getInventoryActivationBlockers({
          title: item.title,
          category: item.category,
          sku: item.sku,
          price: moneyNumber(item.price),
          quantity: Number(item.quantity || 0),
          imageUrl: product?.image_url || null,
          metadata: item.metadata,
        }).length > 0
      );
    }).length;

    const summary = {
      totalItems: inventoryItems.length,
      draftCount: inventoryItems.filter((item) => item.status === "draft").length,
      draftReadyCount,
      draftNeedsWorkCount,
      activeCount: inventoryItems.filter((item) => item.status === "active").length,
      archivedCount: inventoryItems.filter((item) => item.status === "archived")
        .length,
      storeOwnedCount: inventoryItems.filter((item) => !item.seller_account_id)
        .length,
      instacompDraftCount,
      instacompReadyDraftCount,
      totalQuantity,
      totalDraftValue,
      standardEnvelopeCount: items.filter(
        (item) => item.shippingPlan.method === "STANDARD_ENVELOPE",
      ).length,
      sellerProtectionOptInCount: items.filter(
        (item) => item.shippingPlan.sellerProtectionOptedIn,
      ).length,
    };

    return Response.json(
      {
        success: true,
        summary,
        items,
        recentItems,
      },
      {
        headers: sellerInventoryHeaders(summary),
      },
    );
  } catch (error: any) {
    if (isMissingSellerInventoryTables(error)) {
      return Response.json(
        {
          error:
            "Seller inventory is not available until the inventory migrations are applied.",
        },
        { status: 503 },
      );
    }

    return Response.json(
      {
        error: error.message || "Could not load seller inventory",
      },
      { status: 500 },
    );
  }
}
