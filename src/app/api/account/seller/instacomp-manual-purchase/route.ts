import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/account-auth";
import { postInstaCompMacAccounting } from "../../../../../lib/instacomp-mac-accounting-client";

export const dynamic = "force-dynamic";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function requireSeller(request: Request) {
  const account = await getAuthenticatedAccountFromRequest(request);
  if (!account) return null;
  await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });
  return account;
}

function draftPayload(body: Record<string, any>, actor: string) {
  const cards = Array.isArray(body.cards) ? body.cards.slice(0, 250) : [];
  return {
    lot_id: text(body.lotId || body.lot_id) || null,
    mode: body.mode === "lot" ? "lot" : "single",
    source: text(body.source) || "Misc",
    purchased_at: text(body.purchaseDate || body.purchased_at) || null,
    seller: text(body.seller) || null,
    order_number: text(body.orderNumber || body.order_number) || null,
    reference_text: text(body.referenceText || body.reference_text) || null,
    total_cost: Number(body.totalCost ?? body.total_cost ?? 0),
    notes: text(body.notes) || null,
    cards: cards.map((raw: unknown) => {
      const card = object(raw);
      return {
        id: text(card.id) || null,
        title: text(card.title) || null,
        identity: object(card.identity),
        card_uuid: text(card.cardUuid || card.card_uuid) || null,
        scan_id: text(card.scanId || card.scan_id) || null,
        inventory_item_id: text(card.inventoryItemId || card.inventory_item_id) || null,
        allocated_cost:
          card.allocatedCost === "" || card.allocated_cost === ""
            ? null
            : Number(card.allocatedCost ?? card.allocated_cost ?? 0) || null,
        individual_cost_exact:
          card.individualCostExact === true || card.individual_cost_exact === true,
      };
    }),
    actor,
  };
}

export async function POST(request: Request) {
  try {
    const account = await requireSeller(request);
    if (!account) return Response.json({ error: "Seller login is required." }, { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, any>;
    const action = text(body.action);
    const actor = text(account.email) || account.id;

    if (action === "draft") {
      const data = await postInstaCompMacAccounting(
        "/v1/kingmaker/accounting/manual-purchase-draft",
        draftPayload(body, actor),
        30_000,
      );
      return Response.json(data, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "confirm") {
      const data = await postInstaCompMacAccounting(
        "/v1/kingmaker/accounting/manual-purchase-confirm",
        {
          lot_id: text(body.lotId || body.lot_id),
          allocation_method: body.allocationMethod === "manual" ? "manual" : "equal_split",
          disposition: body.disposition === "investment_stash" ? "investment_stash" : "resale",
          actor,
        },
        30_000,
      );
      return Response.json(data, { headers: { "Cache-Control": "no-store" } });
    }

    return Response.json({ error: "Unsupported manual purchase action." }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
