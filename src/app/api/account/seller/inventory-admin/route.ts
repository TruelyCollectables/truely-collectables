import { getAuthenticatedAccountFromRequest } from "../../../../../lib/account-auth";
import { postInstaCompMacAccounting } from "../../../../../lib/instacomp-mac-accounting-client";
import { isStoreOwnerSellerAccount } from "../../../../../lib/seller-inventory-access";

export const dynamic = "force-dynamic";

const MAX_BULK_EDITS = 100;

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
  updateEbay?: unknown;
};

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

async function requireStoreOwner(request: Request) {
  const account = await getAuthenticatedAccountFromRequest(request);
  if (!account) return { account: null, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!isStoreOwnerSellerAccount(account.email)) {
    return {
      account,
      response: Response.json(
        { error: "Seller Inventory Admin is restricted to the Truely Collectables store owner." },
        { status: 403 },
      ),
    };
  }
  return { account, response: null };
}

export async function GET(request: Request) {
  try {
    const auth = await requireStoreOwner(request);
    if (auth.response || !auth.account) return auth.response!;

    const mac = await postInstaCompMacAccounting(
      "/v1/kingmaker/accounting/commercial-inventory",
      { action: "list" },
      120_000,
    );

    return Response.json({
      success: true,
      sourceOfTruth: "mac_local",
      account: { email: auth.account.email, isStoreOwner: true },
      summary: mac.summary || null,
      items: Array.isArray(mac.items) ? mac.items : [],
      ebaySnapshot: mac.ebaySnapshot || null,
      boundaries: {
        inventoryAuthority: "mac_local",
        ebayCredentialAuthority: "mac_local",
        editsMacInventory: true,
        revisesExistingEbayListings: true,
        createsReplacementEbayListings: false,
        buysPostage: false,
        createsOrders: false,
      },
    });
  } catch (error: any) {
    return Response.json(
      { error: error?.message || "Could not load Mac-local seller inventory administration." },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireStoreOwner(request);
    if (auth.response || !auth.account) return auth.response!;

    const body = await request.json().catch(() => ({}));
    const edits = normalizeEdits(body.items);
    if (!edits.length) {
      return Response.json(
        { error: "Select and edit at least one inventory listing." },
        { status: 400 },
      );
    }

    const mac = await postInstaCompMacAccounting(
      "/v1/kingmaker/accounting/commercial-inventory",
      { action: "update", items: edits },
      120_000,
    );

    return Response.json({
      success: mac.success === true,
      sourceOfTruth: "mac_local",
      ownerAccount: true,
      summary: mac.summary || {
        requestedCount: edits.length,
        processedCount: 0,
        successCount: 0,
        failureCount: edits.length,
      },
      results: Array.isArray(mac.results) ? mac.results : [],
      boundaries: {
        inventoryAuthority: "mac_local",
        ebayCredentialAuthority: "mac_local",
        editsMacInventory: true,
        revisesExistingEbayListings: true,
        createsReplacementEbayListings: false,
      },
    });
  } catch (error: any) {
    return Response.json(
      { error: error?.message || "Could not save Mac-local seller inventory edits." },
      { status: 502 },
    );
  }
}
