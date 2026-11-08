import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/kingmaker-local-auth";
import {
  getMacMasterListingRows,
  updateMacKingmakerDrafts,
} from "../../../../../../lib/kingmaker-mac-scan-server";

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

    const isOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    const rows = await getMacMasterListingRows(ids, 10_000);
    const eligibleRows = rows.filter((row: any) => {
      const sellerAccountId = clean(row.seller_account_id ?? row.sellerAccountId, 200);
      const status = clean(row.status, 80);
      return (
        (status === "draft" || status === "active") &&
        (isOwner || !sellerAccountId || sellerAccountId === account.id)
      );
    });
    if (eligibleRows.length !== ids.length) {
      return Response.json(
        { error: `Only ${eligibleRows.length} of ${ids.length} selected listings were eligible for editing.` },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    let cardConditionUpdatedCount = 0;
    let gradedSkippedCount = 0;
    const edits = eligibleRows.map((row: any) => {
      const edit: Record<string, unknown> = { updatedAt: now };
      if (category) edit.category = category;
      if (condition) edit.condition = condition;

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
          edit.metadata = {
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

      return {
        inventoryItemId: clean(row.id ?? row.inventoryItemId ?? row.inventory_item_id, 100),
        edit,
      };
    });
    await updateMacKingmakerDrafts(edits, 20_000);

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
