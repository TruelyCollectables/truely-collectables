import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/account-auth";
import {
  extractAuthenticityProfile,
  mergeAuthenticityIntoMetadata,
  sanitizeAuthenticityProfile,
  validateAuthenticityProfile,
  type AuthenticityProfile,
} from "../../../../../lib/authenticity";
import {
  getUnder20SellerProtectionOptIn,
  mergeUnder20SellerProtectionOptIn,
} from "../../../../../lib/shipping";
import {
  canManageSellerInventoryRow,
  isStoreOwnerSellerAccount,
} from "../../../../../lib/seller-inventory-access";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import {
  inventoryEngine,
  InventoryEngineError,
  type InventoryStatus,
} from "../../../../../modules/inventory";

export const dynamic = "force-dynamic";

const EDITABLE_STATUSES = new Set<InventoryStatus>([
  "draft",
  "active",
  "archived",
]);

const MAX_BULK_EDITS = 100;

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
  player: string | null;
  sport: string | null;
  image_url: string | null;
  ebay_item_id: string | null;
};

type InventoryAdminEdit = {
  inventoryItemId?: unknown;
  title?: unknown;
  player?: unknown;
  sport?: unknown;
  price?: unknown;
  quantity?: unknown;
  status?: unknown;
  category?: unknown;
  condition?: unknown;
  imageUrl?: unknown;
  description?: unknown;
  authenticity?: unknown;
  under20SellerProtectionOptIn?: unknown;
};

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function textValue(value: unknown, maxLength: number) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function requiredText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function moneyValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.round(parsed * 100) / 100)
    : 0;
}

function quantityValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function statusValue(value: unknown): InventoryStatus | null {
  const status = String(value || "").trim() as InventoryStatus;
  return EDITABLE_STATUSES.has(status) ? status : null;
}

function imageUrlValue(value: unknown) {
  const text = textValue(value, 2000);
  if (!text) return null;

  try {
    const parsed = new URL(text);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function isMissingInventorySchema(error: { code?: string; message?: string }) {
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
        "Seller inventory administration is unavailable until the inventory migrations are applied.",
    },
    { status: 503 },
  );
}

function normalizeEdits(value: unknown): InventoryAdminEdit[] {
  if (!Array.isArray(value)) return [];

  const byId = new Map<string, InventoryAdminEdit>();
  for (const raw of value.slice(0, MAX_BULK_EDITS)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const edit = raw as InventoryAdminEdit;
    const inventoryItemId = String(edit.inventoryItemId || "").trim();
    if (!inventoryItemId) continue;
    byId.set(inventoryItemId, { ...edit, inventoryItemId });
  }

  return Array.from(byId.values());
}

function mapItem(params: {
  row: InventoryRow;
  product: ProductRow | null;
  accountId: string;
  ownerAccount: boolean;
}) {
  const { row, product, accountId, ownerAccount } = params;
  const ownershipScope = row.seller_account_id === accountId ? "seller" : "store";

  return {
    inventoryItemId: row.id,
    legacyProductId: row.legacy_product_id,
    ownershipScope,
    canEdit: ownershipScope === "seller" || ownerAccount,
    title: row.title || "Untitled item",
    player: product?.player || null,
    sport: product?.sport || null,
    sku: row.sku || null,
    description: row.description || null,
    category: row.category || "other_collectable",
    condition: row.condition || "unknown",
    status: row.status || "draft",
    quantity: Number(row.quantity || 0),
    price: moneyValue(row.price),
    imageUrl: product?.image_url || null,
    ebayItemId: product?.ebay_item_id || null,
    authenticity: extractAuthenticityProfile(row.metadata),
    under20SellerProtectionOptIn: getUnder20SellerProtectionOptIn(row.metadata),
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

async function loadInventoryRows(params: {
  accountId: string;
  accountEmail: string | null;
}) {
  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();
  const ownerAccount = isStoreOwnerSellerAccount(params.accountEmail);
  let query = supabase
    .from("inventory_items")
    .select(
      "id,legacy_product_id,seller_account_id,sku,title,description,category,condition,status,quantity,price,metadata,updated_at,created_at",
    )
    .eq("store_id", storeId)
    .order("updated_at", { ascending: false });

  query = ownerAccount
    ? query.or(
        `seller_account_id.eq.${params.accountId},seller_account_id.is.null`,
      )
    : query.eq("seller_account_id", params.accountId);

  const { data, error } = await query;
  if (error) throw error;

  return {
    ownerAccount,
    rows: (data || []) as InventoryRow[],
    storeId,
    supabase,
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

    const { ownerAccount, rows, storeId, supabase } = await loadInventoryRows({
      accountId: account.id,
      accountEmail: account.email,
    });
    const legacyProductIds = Array.from(
      new Set(
        rows
          .map((row) => row.legacy_product_id)
          .filter(
            (value): value is number =>
              typeof value === "number" && Number.isInteger(value) && value > 0,
          ),
      ),
    );
    const { data: productData, error: productError } =
      legacyProductIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("products")
            .select("id,player,sport,image_url,ebay_item_id")
            .eq("store_id", storeId)
            .in("id", legacyProductIds);

    if (productError) throw productError;

    const productsById = new Map(
      ((productData || []) as ProductRow[]).map((product) => [product.id, product]),
    );
    const items = rows.map((row) =>
      mapItem({
        row,
        product: row.legacy_product_id
          ? productsById.get(row.legacy_product_id) || null
          : null,
        accountId: account.id,
        ownerAccount,
      }),
    );

    return Response.json({
      success: true,
      account: {
        email: account.email,
        isStoreOwner: ownerAccount,
      },
      summary: {
        totalItems: items.length,
        totalQuantity: items.reduce(
          (total, item) => total + Math.max(0, Number(item.quantity || 0)),
          0,
        ),
        activeCount: items.filter((item) => item.status === "active").length,
        draftCount: items.filter((item) => item.status === "draft").length,
        archivedCount: items.filter((item) => item.status === "archived").length,
        storeOwnedCount: items.filter(
          (item) => item.ownershipScope === "store",
        ).length,
      },
      items,
      boundaries: {
        editsTcosStorefront: true,
        publishesToEbay: false,
        buysPostage: false,
        createsOrders: false,
      },
    });
  } catch (error: any) {
    if (isMissingInventorySchema(error)) return unavailableResponse();

    return Response.json(
      { error: error.message || "Could not load seller inventory administration." },
      { status: 500 },
    );
  }
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

    const body = await request.json().catch(() => ({}));
    const edits = normalizeEdits(body.items);
    if (edits.length === 0) {
      return Response.json(
        { error: "Select and edit at least one inventory listing." },
        { status: 400 },
      );
    }

    const { ownerAccount, rows, storeId, supabase } = await loadInventoryRows({
      accountId: account.id,
      accountEmail: account.email,
    });
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const results: Array<{
      inventoryItemId: string;
      legacyProductId: number | null;
      success: boolean;
      status: number;
      message: string;
    }> = [];

    for (const edit of edits) {
      const inventoryItemId = String(edit.inventoryItemId || "").trim();
      const row = rowsById.get(inventoryItemId);

      if (!row) {
        results.push({
          inventoryItemId,
          legacyProductId: null,
          success: false,
          status: 404,
          message: "Inventory listing was not found or is not owned by this seller.",
        });
        continue;
      }

      if (
        !canManageSellerInventoryRow({
          accountId: account.id,
          accountEmail: account.email,
          sellerAccountId: row.seller_account_id,
        })
      ) {
        results.push({
          inventoryItemId,
          legacyProductId: row.legacy_product_id,
          success: false,
          status: 403,
          message: "Seller ownership does not permit editing this listing.",
        });
        continue;
      }

      if (!row.legacy_product_id) {
        results.push({
          inventoryItemId,
          legacyProductId: null,
          success: false,
          status: 409,
          message: "Listing is missing its linked product record.",
        });
        continue;
      }

      const currentStatus = String(row.status || "draft");
      if (currentStatus === "sold" || currentStatus === "reserved") {
        results.push({
          inventoryItemId,
          legacyProductId: row.legacy_product_id,
          success: false,
          status: 409,
          message: "Sold or reserved inventory is read-only in this workspace.",
        });
        continue;
      }

      const current = await inventoryEngine.getByLegacyProductId(
        row.legacy_product_id,
      );
      if (!current || current.inventoryItemId !== row.id) {
        results.push({
          inventoryItemId,
          legacyProductId: row.legacy_product_id,
          success: false,
          status: 404,
          message: "Linked product could not be loaded.",
        });
        continue;
      }

      if (
        !canManageSellerInventoryRow({
          accountId: account.id,
          accountEmail: account.email,
          sellerAccountId: current.sellerAccountId,
        })
      ) {
        results.push({
          inventoryItemId,
          legacyProductId: row.legacy_product_id,
          success: false,
          status: 403,
          message: "Linked product ownership does not permit this edit.",
        });
        continue;
      }

      const title = requiredText(edit.title ?? current.title, 200);
      const player = textValue(edit.player ?? current.player, 120);
      const sport = textValue(edit.sport ?? current.sport, 120);
      const price = moneyValue(edit.price ?? current.price);
      const requestedStatus = statusValue(edit.status ?? current.status);
      let quantity = quantityValue(edit.quantity ?? current.quantity);
      const description = textValue(edit.description ?? current.description, 8000);
      const category =
        requiredText(edit.category ?? row.category ?? "other_collectable", 120) ||
        "other_collectable";
      const condition =
        requiredText(edit.condition ?? row.condition ?? "unknown", 120) ||
        "unknown";
      const suppliedImageUrl = edit.imageUrl === undefined
        ? current.imageUrl
        : imageUrlValue(edit.imageUrl);
      const rawImageText = textValue(edit.imageUrl, 2000);
      const authenticity = sanitizeAuthenticityProfile(
        edit.authenticity ?? extractAuthenticityProfile(row.metadata),
      ) as AuthenticityProfile;
      const authenticityError = validateAuthenticityProfile(authenticity);
      const protectionOptIn =
        edit.under20SellerProtectionOptIn === undefined
          ? getUnder20SellerProtectionOptIn(row.metadata)
          : edit.under20SellerProtectionOptIn === true;

      if (!title) {
        results.push({
          inventoryItemId,
          legacyProductId: row.legacy_product_id,
          success: false,
          status: 400,
          message: "Title is required.",
        });
        continue;
      }

      if (!requestedStatus) {
        results.push({
          inventoryItemId,
          legacyProductId: row.legacy_product_id,
          success: false,
          status: 400,
          message: "Status must be draft, active, or archived.",
        });
        continue;
      }

      if (rawImageText && !suppliedImageUrl) {
        results.push({
          inventoryItemId,
          legacyProductId: row.legacy_product_id,
          success: false,
          status: 400,
          message: "Image URL must use HTTP or HTTPS.",
        });
        continue;
      }

      if (authenticityError) {
        results.push({
          inventoryItemId,
          legacyProductId: row.legacy_product_id,
          success: false,
          status: 400,
          message: authenticityError,
        });
        continue;
      }

      if (requestedStatus === "archived") quantity = 0;
      if (requestedStatus === "active" && quantity <= 0) {
        results.push({
          inventoryItemId,
          legacyProductId: row.legacy_product_id,
          success: false,
          status: 409,
          message: "Active listings must have quantity above zero.",
        });
        continue;
      }

      if (requestedStatus === "active" && price <= 0) {
        results.push({
          inventoryItemId,
          legacyProductId: row.legacy_product_id,
          success: false,
          status: 409,
          message: "Active listings must have a positive price.",
        });
        continue;
      }

      try {
        await inventoryEngine.updateProduct(row.legacy_product_id, {
          title,
          description,
          player,
          sport,
          price,
          quantity,
          status: requestedStatus,
          imageUrl: suppliedImageUrl,
          authenticity,
        });

        const nextMetadata = mergeUnder20SellerProtectionOptIn(
          mergeAuthenticityIntoMetadata(row.metadata, authenticity),
          protectionOptIn,
        );
        const { error: rowUpdateError } = await supabase
          .from("inventory_items")
          .update({
            category,
            condition,
            metadata: nextMetadata,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id)
          .eq("store_id", storeId);

        if (rowUpdateError) throw rowUpdateError;

        results.push({
          inventoryItemId,
          legacyProductId: row.legacy_product_id,
          success: true,
          status: 200,
          message: "Listing saved in TCOS inventory.",
        });
      } catch (error: any) {
        results.push({
          inventoryItemId,
          legacyProductId: row.legacy_product_id,
          success: false,
          status:
            error instanceof InventoryEngineError ? error.statusCode : 500,
          message: error.message || "Could not save this listing.",
        });
      }
    }

    const successCount = results.filter((result) => result.success).length;
    const failureCount = results.length - successCount;

    return Response.json({
      success: failureCount === 0,
      ownerAccount,
      summary: {
        requestedCount: edits.length,
        processedCount: results.length,
        successCount,
        failureCount,
      },
      results,
      boundaries: {
        editsTcosStorefront: true,
        publishesToEbay: false,
      },
    });
  } catch (error: any) {
    if (isMissingInventorySchema(error)) return unavailableResponse();

    return Response.json(
      { error: error.message || "Could not save seller inventory edits." },
      { status: 500 },
    );
  }
}
