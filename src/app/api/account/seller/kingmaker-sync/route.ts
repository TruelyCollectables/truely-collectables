import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/kingmaker-local-auth";
import { postInstaCompMacAccounting } from "../../../../../lib/instacomp-mac-accounting-client";
import { syncRecentEbayOrderSales } from "../../../../../lib/ebay-order-sale-sync";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });

    const body = await request.json().catch(() => ({}));
    const lookbackDays = Math.min(Math.max(Math.floor(Number(body.lookbackDays || 14)), 1), 90);
    const deactivateMercari = body.deactivateMercari !== false;
    const dryRun = body.dryRun === true;

    let supabaseSync: unknown = null;
    try {
      supabaseSync = await syncRecentEbayOrderSales({
        supabase: createSupabaseServerClient({ admin: true }),
        storeId: getActiveStoreId(),
        lookbackDays,
      });
    } catch (err) {
      supabaseSync = { error: err instanceof Error ? err.message : "Supabase eBay sync skipped" };
    }

    const macSync = await postInstaCompMacAccounting(
      "/v1/kingmaker/accounting/cross-marketplace-sync",
      {
        lookback_days: lookbackDays,
        deactivate_mercari: deactivateMercari,
        dry_run: dryRun,
      },
      180_000,
    );

    return Response.json({
      ok: true,
      supabaseSync,
      ...(macSync && typeof macSync === "object" ? macSync : { macSync }),
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Cross-marketplace sync failed." },
      { status: 500 },
    );
  }
}
