import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/account-auth";
import { postInstaCompMacAccounting } from "../../../../../lib/instacomp-mac-accounting-client";
import {
  getMacMasterListingRow,
  updateMacKingmakerDraft,
} from "../../../../../lib/kingmaker-mac-scan-server";

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

async function persistPurchaseMatches(
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

  await runWithConcurrency(usable, 8, async (entry) => {
    const row = await getMacMasterListingRow(entry.inventoryItemId, 5_000);
    if (!row) return;
    const metadata = record(row.metadata);
    const instaComp = record(metadata.instacomp);
    const match = entry.match;
    const updatedAt = new Date().toISOString();
    await updateMacKingmakerDraft(entry.inventoryItemId, {
      metadata: {
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
      },
    });
  });
}

async function assertPermittedInventoryIds(
  account: { id: string; email?: string | null },
  inventoryItemIds: string[],
) {
  const ids = [...new Set(inventoryItemIds.map(text).filter(Boolean))];
  if (!ids.length) throw new Error("A verified inventory item is required.");

  const isOwner = [
    "sales@truelycollectables.com",
    "sales@trulycollectables.com",
  ].includes(text(account.email).toLowerCase());

  await runWithConcurrency(ids, 8, async (inventoryItemId) => {
    const row = await getMacMasterListingRow(inventoryItemId, 5_000);
    if (!row) throw new Error("One or more Mac-local inventory items were not found.");
    const sellerAccountId = text(row.seller_account_id);
    if (!isOwner && sellerAccountId && sellerAccountId !== account.id) {
      throw new Error("One or more inventory items are not available to this seller.");
    }
  });
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
        await persistPurchaseMatches(
          Array.isArray(data?.results) ? data.results : [],
        );
      } catch (error) {
        console.error("KINGMAKER purchase-match local metadata persistence failed", error);
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
      await persistPurchaseMatches([
        {
          ...record(data),
          inventoryItemId:
            text(record(data).inventoryItemId) || inventoryItemId,
        },
      ]);
    } catch (error) {
      console.error("KINGMAKER purchase-match local metadata persistence failed", error);
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
