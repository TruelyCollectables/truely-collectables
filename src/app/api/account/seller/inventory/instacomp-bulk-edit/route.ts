import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function inventoryIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => clean(entry, 100)).filter(Boolean))].slice(0, 100);
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ error: "Unauthorized" }, { status: 401 });

    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });

    const body = await request.json().catch(() => ({}));
    const ids = inventoryIds(body.inventoryItemIds);
    const category = clean(body.category, 160);
    const condition = clean(body.condition, 120);
    if (!ids.length) {
      return Response.json({ error: "Select at least one master listing." }, { status: 400 });
    }
    if (!category && !condition) {
      return Response.json({ error: "Category or condition is required." }, { status: 400 });
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    const changes: Record<string, string> = { updated_at: new Date().toISOString() };
    if (category) changes.category = category;
    if (condition) changes.condition = condition;

    let update = supabase
      .from("inventory_items")
      .update(changes)
      .eq("store_id", storeId)
      .eq("status", "draft")
      .in("id", ids);
    update = isOwner
      ? update.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : update.eq("seller_account_id", account.id);
    const { data, error } = await update.select("id");
    if (error) throw error;

    const updatedCount = data?.length || 0;
    if (updatedCount !== ids.length) {
      return Response.json(
        { error: `Only ${updatedCount} of ${ids.length} selected drafts were eligible for editing.` },
        { status: 409 },
      );
    }
    return Response.json({ success: true, updatedCount, published: false });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not bulk edit master listings." },
      { status: 500 },
    );
  }
}
