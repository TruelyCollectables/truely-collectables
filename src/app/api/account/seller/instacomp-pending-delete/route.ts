import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/kingmaker-local-auth";
import {
  deleteMacMasterListings,
  getMacMasterListingRows,
} from "../../../../../lib/kingmaker-mac-scan-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function ids(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => String(entry ?? "").trim().slice(0, 200))
        .filter(Boolean),
    ),
  ).slice(0, 100);
}

export async function DELETE(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ error: "Seller login is required." }, { status: 401 });
    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });
    const body = await request.json().catch(() => ({}));
    const requestedIds = ids((body as Record<string, unknown>).inventoryItemIds);
    if (!requestedIds.length) {
      return Response.json({ error: "Select at least one pending draft." }, { status: 400 });
    }

    const owner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    const rows = await getMacMasterListingRows(requestedIds, 10_000);
    const eligibleIds = rows
      .filter((row) => {
        const seller = String(row.seller_account_id ?? "").trim();
        const metadata = record(row.metadata);
        const projection = record(metadata.master_listing_projection);
        const folder = String(projection.folder ?? row.folder ?? "pending").trim();
        const status = String(row.status ?? "").trim();
        return (
          status !== "active" &&
          status !== "sold" &&
          status !== "archived" &&
          folder === "pending" &&
          (owner || !seller || seller === account.id)
        );
      })
      .map((row) => String(row.id ?? row.inventoryItemId ?? row.inventory_item_id ?? "").trim())
      .filter(Boolean);

    if (eligibleIds.length !== requestedIds.length) {
      return Response.json(
        {
          success: false,
          error: `Only ${eligibleIds.length} of ${requestedIds.length} selected pending drafts were eligible for deletion.`,
        },
        { status: 409 },
      );
    }

    const results = await deleteMacMasterListings(eligibleIds, 15_000);
    const deletedCount = results.filter((result) => result.success === true).length;
    if (deletedCount !== eligibleIds.length) {
      return Response.json(
        {
          success: false,
          error: `Mac-local deletion completed for ${deletedCount} of ${eligibleIds.length} drafts.`,
        },
        { status: 500 },
      );
    }
    return Response.json({
      success: true,
      deletedCount,
      sourceAuthority: "mac_local_sqlite",
      message: `${deletedCount} pending draft${deletedCount === 1 ? "" : "s"} deleted from KINGMAKER.`,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not delete pending drafts." },
      { status: 500 },
    );
  }
}
