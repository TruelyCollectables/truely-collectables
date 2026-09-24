import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/account-auth";
import { postInstaCompMacAccounting } from "../../../../../lib/instacomp-mac-accounting-client";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let nextIndex = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) },
      async () => {
        while (nextIndex < items.length) {
          const item = items[nextIndex++];
          await worker(item);
        }
      },
    ),
  );
}

async function mirrorPurchaseMatches(
  results: Array<Record<string, unknown>>,
) {
  const usable = results
    .map((result) => ({
      result,
      inventoryItemId: text(result.inventoryItemId),
      match: record(result.match),
    }))
    .filter(
      (entry) =>
        Boolean(entry.inventoryItemId) && Boolean(text(entry.match.source)),
    );
  if (!usable.length) return;

  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const ids = Array.from(new Set(usable.map((entry) => entry.inventoryItemId)));
  const { data, error } = await supabase
    .from("inventory_items")
    .select("id,metadata")
    .eq("store_id", storeId)
    .in("id", ids);
  if (error) throw error;
  const byId = new Map(usable.map((entry) => [entry.inventoryItemId, entry]));

  await runWithConcurrency(data || [], 8, async (row: any) => {
    const entry = byId.get(String(row.id));
    if (!entry) return;
    const metadata = record(row.metadata);
    const instaComp = record(metadata.instacomp);
    const match = entry.match;
    const updatedAt = new Date().toISOString();
    const nextMetadata = {
      ...metadata,
      instacomp: {
        ...instaComp,
        acquisition: {
          ...record(instaComp.acquisition),
          source: text(match.source) || "Misc",
          acquisitionItemId:
            Number(match.acquisitionItemId || match.purchaseId || 0) || null,
          purchaseId: text(match.purchaseId) || null,
          purchaseDate: text(match.purchaseDate) || null,
          allocatedCost: Number(match.allocatedCost || 0),
          costStatus:
            Number(match.allocatedCost || 0) > 0 ? "known" : "unknown",
          receiptStatus: text(entry.result.status) || null,
          inventoryState: text(entry.result.inventoryState) || null,
          disposition: text(entry.result.disposition) || null,
          authority: "mac_local_accounting",
          updatedAt,
        },
      },
    };
    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ metadata: nextMetadata, updated_at: updatedAt })
      .eq("store_id", storeId)
      .eq("id", row.id);
    if (updateError) throw updateError;
  });
}

async function assertPermittedInventoryIds(
  account: { id: string; email?: string | null },
  inventoryItemIds: string[],
) {
  const ids = [...new Set(inventoryItemIds.map(text).filter(Boolean))];
  if (!ids.length) throw new Error("A verified inventory item is required.");

  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const isOwner = [
    "sales@truelycollectables.com",
    "sales@trulycollectables.com",
  ].includes(text(account.email).toLowerCase());

  // Mac-local KINGMAKER items may not have a Supabase storefront mirror yet.
  // Existing mirrored rows still enforce seller ownership; missing rows are
  // validated by the Mac scan/accounting authority in the next call.
  const { data, error } = await supabase
    .from("inventory_items")
    .select("id,seller_account_id")
    .eq("store_id", storeId)
    .in("id", ids);
  if (error) throw error;

  if (!isOwner) {
    const unauthorized = (data || []).some(
      (row: { seller_account_id?: string | null }) =>
        String(row.seller_account_id || "") !== String(account.id),
    );
    if (unauthorized) {
      throw new Error("One or more inventory items are not available to this seller.");
    }
  }
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return Response.json({ error: "Seller login is required." }, { status: 401 });
    }
    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const body = await request.json();
    const bulkItems = Array.isArray(body.items)
      ? body.items
          .slice(0, 500)
          .map((item: any) => ({
            card_uuid: text(item?.cardUuid),
            inventory_item_id: text(item?.inventoryItemId),
            scan_id: text(item?.scanId),
            identity:
              item?.identity && typeof item.identity === "object"
                ? item.identity
                : {},
          }))
          .filter((item: any) => Boolean(item.inventory_item_id && item.scan_id))
      : null;

    if (bulkItems) {
      if (!bulkItems.length) {
        return Response.json(
          { error: "No verified seller inventory scans were supplied." },
          { status: 400 },
        );
      }
      await assertPermittedInventoryIds(
        account,
        bulkItems.map((item: any) => item.inventory_item_id),
      );

      const data = await postInstaCompMacAccounting(
        "/v1/kingmaker/accounting/purchase-match-bulk",
        { items: bulkItems },
        30_000,
      );
      try {
        await mirrorPurchaseMatches(
          Array.isArray(data?.results) ? data.results : [],
        );
      } catch (error) {
        console.error("KINGMAKER purchase-match mirror failed", error);
      }
      return Response.json(data, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const inventoryItemId = text(body.inventoryItemId);
    const scanId = text(body.scanId);
    if (!inventoryItemId || !scanId) {
      return Response.json(
        { error: "A verified inventory item and physical scan are required." },
        { status: 400 },
      );
    }
    await assertPermittedInventoryIds(account, [inventoryItemId]);
    const data = await postInstaCompMacAccounting(
      "/v1/kingmaker/accounting/purchase-match",
      {
        card_uuid: text(body.cardUuid),
        inventory_item_id: inventoryItemId,
        scan_id: scanId,
        identity:
          body.identity && typeof body.identity === "object"
            ? body.identity
            : {},
      },
    );
    try {
      await mirrorPurchaseMatches([
        {
          ...record(data),
          inventoryItemId:
            text(record(data).inventoryItemId) || inventoryItemId,
        },
      ]);
    } catch (error) {
      console.error("KINGMAKER purchase-match mirror failed", error);
    }

    return Response.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
