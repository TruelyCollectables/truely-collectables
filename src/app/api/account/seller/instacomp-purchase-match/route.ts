import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/account-auth";
import { postInstaCompMacAccounting } from "../../../../../lib/instacomp-mac-accounting-client";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ error: "Seller login is required." }, { status: 401 });
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });
    const body = await request.json();
    const bulkItems = Array.isArray(body.items)
      ? body.items
          .slice(0, 500)
          .map((item: any) => ({
            card_uuid: String(item?.cardUuid || ""),
            inventory_item_id: item?.inventoryItemId ? String(item.inventoryItemId) : null,
            identity: item?.identity && typeof item.identity === "object" ? item.identity : {},
          }))
          .filter((item: any) => Boolean(item.card_uuid))
      : null;
    const data = bulkItems
      ? await postInstaCompMacAccounting(
          "/v1/kingmaker/accounting/purchase-match-bulk",
          { items: bulkItems },
          30_000,
        )
      : await postInstaCompMacAccounting("/v1/kingmaker/accounting/purchase-match", {
          card_uuid: String(body.cardUuid || ""),
          inventory_item_id: body.inventoryItemId ? String(body.inventoryItemId) : null,
          identity: body.identity && typeof body.identity === "object" ? body.identity : {},
        });
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
