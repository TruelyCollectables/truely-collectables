import { NextRequest } from "next/server";
import { getAuthenticatedAccountFromRequest } from "../../../../../lib/kingmaker-verified-csv-auth";
import { verifiedCsvMac } from "../../../../../lib/kingmaker-verified-csv-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams, side = p.get("side"), itemId = p.get("inventoryItemId"), sha = p.get("sha256");
    if (side !== "front" && side !== "back") return Response.json({ error: "Choose front or back." }, { status: 400 });
    const query = new URLSearchParams({ side });
    if (itemId && sha) {
      if (!/^[0-9a-f-]{36}$/i.test(itemId) || !/^[0-9a-f]{64}$/.test(sha)) return Response.json({ error: "Invalid image reference." }, { status: 404 });
      query.set("inventory_item_id", itemId); query.set("sha256", sha);
    } else {
      const account = await getAuthenticatedAccountFromRequest(request);
      if (!account) return Response.json({ error: "Unauthorized" }, { status: 401 });
      query.set("owner_id", account.id);
      if (itemId) query.set("inventory_item_id", itemId);
      else if (p.get("token") && p.get("line")) { query.set("token", p.get("token")!); query.set("line", p.get("line")!); }
      else return Response.json({ error: "An inventory ID or preview token and row is required." }, { status: 400 });
    }
    const response = await verifiedCsvMac("image?" + query);
    return new Response(await response.arrayBuffer(), { headers: { "Content-Type": response.headers.get("content-type") || "image/jpeg", "Cache-Control": itemId && sha ? "public, max-age=31536000, immutable" : "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Image unavailable." }, { status: 404 }); }
}
