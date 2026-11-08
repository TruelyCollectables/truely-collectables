import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .map((entry) => String(entry || "").trim())
            .filter(Boolean),
        ),
      )
    : [];
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const body = await request.json().catch(() => ({}));
    const stagedItemId = String(body.stagedItemId || "").trim();
    const action = String(body.action || "").trim();
    if (
      !stagedItemId ||
      !["approve_to_draft", "deny_forever"].includes(action)
    ) {
      return Response.json(
        { error: "A valid intake decision is required." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const [
      { data: row, error: rowError },
      { data: connection, error: connectionError },
    ] = await Promise.all([
      supabase
        .from("seller_marketplace_staged_items")
        .select("id,source_item_id,title,metadata")
        .eq("id", stagedItemId)
        .eq("account_id", account.id)
        .eq("store_id", storeId)
        .eq("provider", "ebay")
        .single(),
      supabase
        .from("seller_marketplace_connections")
        .select("id,provider_metadata")
        .eq("account_id", account.id)
        .eq("store_id", storeId)
        .eq("provider", "ebay")
        .single(),
    ]);

    if (rowError || !row) {
      return Response.json(
        { error: "Seller eBay intake row was not found." },
        { status: 404 },
      );
    }
    if (connectionError || !connection) {
      return Response.json(
        { error: "Seller eBay connection was not found." },
        { status: 409 },
      );
    }

    const metadata = recordValue(row.metadata);
    const sourceId = String(
      row.source_item_id || metadata.source_listing_id || "",
    ).trim();
    if (!sourceId) {
      return Response.json(
        { error: "The eBay source listing ID is missing." },
        { status: 409 },
      );
    }

    const providerMetadata = recordValue(connection.provider_metadata);
    const approved = new Set(
      stringList(providerMetadata.seller_intake_approved_ids),
    );
    const denied = new Set(
      stringList(providerMetadata.seller_intake_denied_ids),
    );
    const now = new Date().toISOString();
    let stageStatus: "staged" | "skipped";
    let intakeLane: string;

    if (action === "approve_to_draft") {
      denied.delete(sourceId);
      approved.add(sourceId);
      stageStatus = "staged";
      intakeLane = "seller_approved";
    } else {
      approved.delete(sourceId);
      denied.add(sourceId);
      stageStatus = "skipped";
      intakeLane = "seller_denied";
    }

    const [connectionUpdate, rowUpdate] = await Promise.all([
      supabase
        .from("seller_marketplace_connections")
        .update({
          provider_metadata: {
            ...providerMetadata,
            seller_intake_approved_ids: Array.from(approved).slice(-2000),
            seller_intake_denied_ids: Array.from(denied).slice(-2000),
            seller_intake_decision_updated_at: now,
          },
          updated_at: now,
        })
        .eq("id", connection.id),
      supabase
        .from("seller_marketplace_staged_items")
        .update({
          stage_status: stageStatus,
          metadata: {
            ...metadata,
            intake_lane: intakeLane,
            intake_reason:
              action === "approve_to_draft"
                ? "seller approved for private draft promotion"
                : "seller denied forever",
            seller_intake_decision: action,
            seller_intake_decision_at: now,
          },
          updated_at: now,
        })
        .eq("id", stagedItemId)
        .eq("account_id", account.id)
        .eq("store_id", storeId)
        .select("id,source_item_id,title,stage_status,metadata")
        .single(),
    ]);

    if (connectionUpdate.error) throw connectionUpdate.error;
    if (rowUpdate.error) throw rowUpdate.error;

    return Response.json({
      success: true,
      action,
      stagedItem: rowUpdate.data,
      approvedCount: approved.size,
      deniedCount: denied.size,
    });
  } catch (error: any) {
    return Response.json(
      {
        error:
          error?.message || "Could not save the seller eBay intake decision.",
      },
      { status: 500 },
    );
  }
}
