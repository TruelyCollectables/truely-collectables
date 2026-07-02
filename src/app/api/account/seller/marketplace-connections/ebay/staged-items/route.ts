import { createClient } from "@supabase/supabase-js";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../../lib/account-auth";
import { stageSellerEbayInventoryBatch } from "../../../../../../../lib/seller-ebay";
import { getActiveStoreId } from "../../../../../../../lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
}

function isMissingSellerStagingTables(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("seller_marketplace_staged_items") ||
    message.includes("seller_marketplace_import_jobs")
  );
}

function unavailableResponse() {
  return Response.json(
    {
      error:
        "Seller marketplace staging is not available until the staging migration is applied.",
    },
    { status: 503 },
  );
}

function cleanStageStatus(value: unknown) {
  const status = String(value || "").trim().toLowerCase();

  return ["staged", "needs_review", "mapped", "skipped"].includes(status)
    ? status
    : null;
}

export async function GET(request: Request) {
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

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const [stagedResult, importJobResult] = await Promise.all([
      supabase
        .from("seller_marketplace_staged_items")
        .select(
          "id,provider,source_item_id,sku,title,quantity,price,currency,offer_status,listing_status,item_condition,image_url,stage_status,metadata,updated_at",
        )
        .eq("account_id", account.id)
        .eq("store_id", storeId)
        .eq("provider", "ebay")
        .order("updated_at", { ascending: false })
        .limit(25),
      supabase
        .from("seller_marketplace_import_jobs")
        .select(
          "id,status,row_count,staged_count,skipped_count,error_count,started_at,completed_at,updated_at",
        )
        .eq("account_id", account.id)
        .eq("store_id", storeId)
        .eq("provider", "ebay")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (stagedResult.error || importJobResult.error) {
      const error = stagedResult.error || importJobResult.error;

      if (error && isMissingSellerStagingTables(error)) {
        return unavailableResponse();
      }

      throw error;
    }

    return Response.json({
      success: true,
      stagedItems: stagedResult.data || [],
      latestImportJob: importJobResult.data || null,
    });
  } catch (error: any) {
    return Response.json(
      {
        error: error.message || "Could not load seller marketplace staged items",
      },
      { status: 500 },
    );
  }
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
    const limit = Number(body.limit || 25);
    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const result = await stageSellerEbayInventoryBatch({
      supabase,
      accountId: account.id,
      storeId,
      limit,
    });

    return Response.json({
      success: true,
      result,
    });
  } catch (error: any) {
    if (isMissingSellerStagingTables(error)) {
      return unavailableResponse();
    }

    const message =
      error.message || "Could not stage seller marketplace listings";

    return Response.json(
      { error: message },
      { status: message.includes("disabled") ? 403 : 500 },
    );
  }
}

export async function PATCH(request: Request) {
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
    const stageStatus = cleanStageStatus(body.stageStatus);

    if (!stagedItemId || !stageStatus) {
      return Response.json(
        { error: "A staged item ID and valid stage status are required." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const { data, error } = await supabase
      .from("seller_marketplace_staged_items")
      .update({
        stage_status: stageStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", stagedItemId)
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .select(
        "id,provider,source_item_id,sku,title,quantity,price,currency,offer_status,listing_status,item_condition,image_url,stage_status,metadata,updated_at",
      )
      .single();

    if (error) {
      if (isMissingSellerStagingTables(error)) {
        return unavailableResponse();
      }

      throw error;
    }

    return Response.json({
      success: true,
      stagedItem: data,
    });
  } catch (error: any) {
    if (isMissingSellerStagingTables(error)) {
      return unavailableResponse();
    }

    return Response.json(
      {
        error: error.message || "Could not update seller staged item status",
      },
      { status: 500 },
    );
  }
}
