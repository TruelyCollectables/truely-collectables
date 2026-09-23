import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/account-auth";
import { getInstaCompMacAccounting } from "../../../../../lib/instacomp-mac-accounting-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
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

    const url = new URL(request.url);
    const cutoff = url.searchParams.get("cutoff_date") || "2026-09-16";
    const data = await getInstaCompMacAccounting(
      `/v1/kingmaker/accounting/pending-receipts?cutoff_date=${encodeURIComponent(cutoff)}`,
    );
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
