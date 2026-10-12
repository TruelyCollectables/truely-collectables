import { NextRequest } from "next/server";
import { getAuthenticatedAccountFromRequest, ensureAccountStoreMembership } from "../../../../../lib/kingmaker-verified-csv-auth";
import { verifiedCsvMac } from "../../../../../lib/kingmaker-verified-csv-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const account = await getAuthenticatedAccountFromRequest(request);
  if (!account) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const response = await verifiedCsvMac("lessons?owner_id="+encodeURIComponent(account.id));
    return Response.json(await response.json(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Lessons unavailable." }, { status: 422 }); }
}
export async function POST(request: NextRequest) {
  const account = await getAuthenticatedAccountFromRequest(request);
  if (!account) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });
    const body = await request.json();
    const replay = body.action === "replay";
    const payload = replay ? { token: body.replayId, owner_id: account.id } : { owner_id: account.id, inventory_item_id: body.inventoryItemId, prediction: body.prediction, model_version: body.modelVersion, source_event_id: body.sourceEventId };
    const response = await verifiedCsvMac(replay ? "replay" : "feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    return Response.json(await response.json());
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Feedback rejected." }, { status: 409 }); }
}
