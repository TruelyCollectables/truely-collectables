import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import { postInstaCompMacAccountingForm } from "../../../../../../lib/instacomp-mac-accounting-client";

export const dynamic = "force-dynamic";

function text(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ error: "Seller login is required." }, { status: 401 });
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });

    const incoming = await request.formData();
    const file = incoming.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      return Response.json({ error: "Choose an evidence file to upload." }, { status: 400 });
    }
    const lotId = text(incoming.get("lotId") || incoming.get("lot_id"));
    if (!lotId) return Response.json({ error: "Save the purchase draft before uploading evidence." }, { status: 400 });

    const outgoing = new FormData();
    outgoing.set("lot_id", lotId);
    outgoing.set("draft_card_id", text(incoming.get("draftCardId") || incoming.get("draft_card_id")));
    outgoing.set("evidence_kind", text(incoming.get("evidenceKind") || incoming.get("evidence_kind")) || "receipt");
    outgoing.set("actor", text(account.email) || account.id);
    outgoing.set("file", file, file.name);

    const data = await postInstaCompMacAccountingForm(
      "/v1/kingmaker/accounting/manual-purchase-evidence",
      outgoing,
      45_000,
    );
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
