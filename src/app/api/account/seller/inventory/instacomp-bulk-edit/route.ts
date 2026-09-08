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

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function inventoryIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => clean(entry, 100)).filter(Boolean))].slice(0, 100);
}

const EBAY_CARD_CONDITIONS = new Set([
  "Near Mint or Better",
  "Excellent",
  "Very Good",
  "Poor",
]);

function ebayCardConditionForCategory(value: string, categoryId: string) {
  if (categoryId !== "183454") return value;
  if (value === "Excellent") return "Lightly Played (Excellent)";
  if (value === "Very Good") return "Moderately Played (Very Good)";
  if (value === "Poor") return "Heavily Played (Poor)";
  return value;
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
    const ebayCardCondition = clean(body.ebayCardCondition, 100);
    if (!ids.length) {
      return Response.json({ error: "Select at least one master listing." }, { status: 400 });
    }
    if (!category && !condition && !ebayCardCondition) {
      return Response.json(
        { error: "Category, inventory condition, or eBay Card Condition is required." },
        { status: 400 },
      );
    }
    if (ebayCardCondition && !EBAY_CARD_CONDITIONS.has(ebayCardCondition)) {
      return Response.json({ error: "Unsupported eBay Card Condition." }, { status: 400 });
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";

    let query = supabase
      .from("inventory_items")
      .select("id,metadata")
      .eq("store_id", storeId)
      .eq("status", "draft")
      .in("id", ids);
    query = isOwner
      ? query.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : query.eq("seller_account_id", account.id);
    const { data: rows, error: rowError } = await query;
    if (rowError) throw rowError;

    const eligibleRows = rows || [];
    if (eligibleRows.length !== ids.length) {
      return Response.json(
        { error: `Only ${eligibleRows.length} of ${ids.length} selected drafts were eligible for editing.` },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    let cardConditionUpdatedCount = 0;
    let gradedSkippedCount = 0;
    await Promise.all(eligibleRows.map(async (row: any) => {
      const changes: Record<string, unknown> = { updated_at: now };
      if (category) changes.category = category;
      if (condition) changes.condition = condition;

      if (ebayCardCondition) {
        const metadata = record(row.metadata);
        const instaComp = record(metadata.instacomp);
        const ai = record(instaComp.ai);
        const grader = clean(ai.gradingCompany || instaComp.gradingCompany, 120);
        if (grader) {
          gradedSkippedCount += 1;
        } else {
          const dual = record(metadata.dual_marketplace);
          const ebay = record(dual.ebay);
          const channelPricing = record(instaComp.channelPricing);
          const ebayCategoryId = clean(ebay.categoryId || channelPricing.ebayCategoryId, 40);
          changes.metadata = {
            ...metadata,
            dual_marketplace: {
              ...dual,
              ebay: {
                ...ebay,
                cardCondition: ebayCardConditionForCategory(ebayCardCondition, ebayCategoryId),
              },
              updatedAt: now,
            },
          };
          cardConditionUpdatedCount += 1;
        }
      }

      const { error } = await supabase
        .from("inventory_items")
        .update(changes)
        .eq("store_id", storeId)
        .eq("id", row.id);
      if (error) throw error;
    }));

    return Response.json({
      success: true,
      updatedCount: eligibleRows.length,
      cardConditionUpdatedCount,
      gradedSkippedCount,
      published: false,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not bulk edit master listings." },
      { status: 500 },
    );
  }
}
