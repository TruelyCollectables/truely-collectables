import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/account-auth";
import { postInstaCompMacAccounting } from "../../../../../lib/instacomp-mac-accounting-client";

export const dynamic = "force-dynamic";

const RECEIVING_CUTOFF = "2026-09-16";
const RECEIVING_CUTOFF_ISO = "2026-09-16T00:00:00-06:00";

async function requireSeller(request: Request) {
  const account = await getAuthenticatedAccountFromRequest(request);
  if (!account) return null;
  await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });
  return account;
}

export async function GET(request: Request) {
  try {
    if (!(await requireSeller(request))) {
      return Response.json({ error: "Seller login is required." }, { status: 401 });
    }
    const data = await postInstaCompMacAccounting(
      "/v1/kingmaker/accounting/pending-purchases",
      { cutoff: RECEIVING_CUTOFF },
      30_000,
    );
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  try {
    if (!(await requireSeller(request))) {
      return Response.json({ error: "Seller login is required." }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    if (body.action !== "sync") {
      return Response.json({ error: "Unsupported Receiving action." }, { status: 400 });
    }
    const data = await postInstaCompMacAccounting(
      "/v1/kingmaker/accounting/purchase-intake-sync",
      { cutoff: RECEIVING_CUTOFF_ISO },
      360_000,
    );
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
