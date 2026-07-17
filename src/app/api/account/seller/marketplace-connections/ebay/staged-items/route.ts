import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../../lib/account-auth";
import {
  sanitizeAuthenticityProfile,
  validateAuthenticityProfile,
} from "../../../../../../../lib/authenticity";
import {
  getInventoryActivationBlockers,
  type InventoryActivationBlocker,
} from "../../../../../../../lib/inventory-activation";
import { stageSellerEbayInventoryBatch } from "../../../../../../../lib/seller-ebay";
import { getActiveStoreId } from "../../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SellerMarketplaceStagedItemRow = {
  id: string;
  import_job_id: string | null;
  provider: string;
  source_item_id: string;
  sku: string | null;
  title: string | null;
  quantity: number | null;
  price: number | string | null;
  currency: string | null;
  offer_status: string | null;
  listing_status: string | null;
  item_condition: string | null;
  image_url: string | null;
  stage_status: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string;
};

type SellerMarketplaceImportJobRow = {
  id: string;
  status: string;
  row_count: number;
  staged_count: number;
  skipped_count: number;
  error_count: number;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  source_cursor: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  current_summary?: {
    total: number;
    ready: number;
    staged: number;
    needs_review: number;
    mapped: number;
    skipped: number;
    blocked: number;
    promoted: number;
  };
};

type ProductDuplicateRow = {
  id: number;
  title: string | null;
  seller_account_id: string | null;
  sku: string | null;
  ebay_item_id: string | null;
};

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
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

function cleanLimit(value: string | null, fallback = 25, max = 250) {
  const limit = Number(value || fallback);

  if (!Number.isFinite(limit)) return fallback;

  return Math.min(Math.max(Math.trunc(limit), 1), max);
}

function cleanStageItemIds(value: unknown) {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((entry) => String(entry || "").trim())
        .filter((entry) => entry.length > 0),
    ),
  ).slice(0, 100);
}

function cleanText(value: unknown) {
  const text = String(value || "").trim();
  return text.length > 0 ? text : null;
}

function isResolvedStageStatus(value: unknown) {
  return value === "mapped" || value === "skipped";
}

function cleanCategoryHint(value: unknown) {
  const category = cleanText(value);

  if (!category) return null;

  return category.toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 80);
}

function numericId(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function metadataRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function isExactDuplicateTrashCandidate(
  item: ReturnType<typeof enrichStagedItems>[number],
) {
  if (isResolvedStageStatus(item.stage_status)) return false;

  const guard = item.promotion_guard;
  if (!guard?.blocked) return false;

  return (
    guard.alreadyPromoted ||
    guard.reasons.includes("existing_ebay_item") ||
    guard.matches.some((match) => match.matchType === "ebay_item_id")
  );
}

async function loadDuplicateProducts(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  storeId: string;
  skuValues: string[];
  ebayItemIds: string[];
}) {
  const [skuResult, ebayItemResult] = await Promise.all([
    params.skuValues.length === 0
      ? Promise.resolve({ data: [], error: null })
      : params.supabase
          .from("products")
          .select("id,title,seller_account_id,sku,ebay_item_id")
          .eq("store_id", params.storeId)
          .in("sku", params.skuValues),
    params.ebayItemIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : params.supabase
          .from("products")
          .select("id,title,seller_account_id,sku,ebay_item_id")
          .eq("store_id", params.storeId)
          .in("ebay_item_id", params.ebayItemIds),
  ]);

  if (skuResult.error) throw skuResult.error;
  if (ebayItemResult.error) throw ebayItemResult.error;

  return {
    skuMatches: (skuResult.data || []) as ProductDuplicateRow[],
    ebayItemMatches: (ebayItemResult.data || []) as ProductDuplicateRow[],
  };
}

function enrichStagedItems(params: {
  accountId: string;
  stagedItems: SellerMarketplaceStagedItemRow[];
  skuMatches: ProductDuplicateRow[];
  ebayItemMatches: ProductDuplicateRow[];
}) {
  const bySku = new Map<string, ProductDuplicateRow[]>();
  const byEbayItemId = new Map<string, ProductDuplicateRow[]>();

  for (const match of params.skuMatches) {
    const sku = cleanText(match.sku);
    if (!sku) continue;
    bySku.set(sku, [...(bySku.get(sku) || []), match]);
  }

  for (const match of params.ebayItemMatches) {
    const ebayItemId = cleanText(match.ebay_item_id);
    if (!ebayItemId) continue;
    byEbayItemId.set(ebayItemId, [...(byEbayItemId.get(ebayItemId) || []), match]);
  }

  return params.stagedItems.map((item) => {
    const metadata = metadataRecord(item.metadata);
    const categoryHint = cleanText(metadata?.category_hint);
    const promotedLegacyProductId = numericId(metadata?.promoted_legacy_product_id);
    const ebayItemId =
      cleanText(metadata?.source_listing_id) || cleanText(item.source_item_id);
    const sku = cleanText(item.sku);
    const rawMatches = [
      ...(ebayItemId
        ? (byEbayItemId.get(ebayItemId) || []).map((match) => ({
            ...match,
            matchType: "ebay_item_id" as const,
          }))
        : []),
      ...(sku
        ? (bySku.get(sku) || []).map((match) => ({
            ...match,
            matchType: "sku" as const,
          }))
        : []),
    ];
    const seen = new Set<string>();
    const matches = rawMatches
      .filter((match) => {
        const key = `${match.id}:${match.matchType}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((match) => ({
        id: match.id,
        title: match.title || "Untitled product",
        sellerScope:
          match.seller_account_id === null
            ? "store_owned"
            : match.seller_account_id === params.accountId
              ? "same_seller"
              : "other_seller",
        matchType: match.matchType,
      }));
    const reasons = [
      ...(promotedLegacyProductId ? ["already_promoted"] : []),
      ...(matches.some((match) => match.matchType === "ebay_item_id")
        ? ["existing_ebay_item"]
        : []),
      ...(matches.some((match) => match.matchType === "sku")
        ? ["existing_sku"]
        : []),
    ];
    const draftActivationBlockers = getInventoryActivationBlockers({
      sku,
      price: Number(item.price || 0),
      quantity: Math.max(0, Number(item.quantity || 0)),
      imageUrl: cleanText(item.image_url),
      title: item.title,
      category: categoryHint,
      metadata,
    });

    return {
      ...item,
      promotion_guard: {
        blocked: reasons.length > 0,
        alreadyPromoted: promotedLegacyProductId !== null,
        promotedLegacyProductId,
        reasons,
        matches,
      },
      draft_activation_readiness: {
        ready: draftActivationBlockers.length === 0,
        blockers: draftActivationBlockers as InventoryActivationBlocker[],
      },
    };
  });
}

function summarizeImportJobOutcomes(stagedItems: Array<
  ReturnType<typeof enrichStagedItems>[number]
>) {
  const summaries: Record<
    string,
    {
      total: number;
      ready: number;
      draft_cleanup: number;
      staged: number;
      needs_review: number;
      mapped: number;
      skipped: number;
      blocked: number;
      promoted: number;
    }
  > = {};

  for (const item of stagedItems) {
    const importJobId = cleanText(item.import_job_id);
    if (!importJobId) continue;

    const summary = summaries[importJobId] || {
      total: 0,
      ready: 0,
      draft_cleanup: 0,
      staged: 0,
      needs_review: 0,
      mapped: 0,
      skipped: 0,
      blocked: 0,
      promoted: 0,
    };

    summary.total += 1;

    if (item.stage_status === "staged") summary.staged += 1;
    if (item.stage_status === "needs_review") summary.needs_review += 1;
    if (item.stage_status === "mapped") summary.mapped += 1;
    if (item.stage_status === "skipped") summary.skipped += 1;
    if (item.promotion_guard?.blocked && !isResolvedStageStatus(item.stage_status)) {
      summary.blocked += 1;
    }
    if (item.promotion_guard?.alreadyPromoted) summary.promoted += 1;
    if (
      item.stage_status === "staged" &&
      !item.promotion_guard?.blocked &&
      item.draft_activation_readiness?.ready
    ) {
      summary.ready += 1;
    }
    if (
      item.stage_status === "staged" &&
      !item.promotion_guard?.blocked &&
      item.draft_activation_readiness?.ready === false
    ) {
      summary.draft_cleanup += 1;
    }

    summaries[importJobId] = summary;
  }

  return summaries;
}

function summarizeStagedItems(stagedItems: Array<
  ReturnType<typeof enrichStagedItems>[number]
>) {
  return stagedItems.reduce(
    (summary, item) => {
      summary.total += 1;

      if (item.stage_status === "staged") summary.staged += 1;
      if (item.stage_status === "needs_review") summary.needsReview += 1;
      if (item.stage_status === "mapped") summary.mapped += 1;
      if (item.stage_status === "skipped") summary.skipped += 1;
      if (item.promotion_guard?.blocked && !isResolvedStageStatus(item.stage_status)) {
        summary.blocked += 1;
      }
      if (item.promotion_guard?.alreadyPromoted) summary.promoted += 1;
      if (
        item.stage_status === "staged" &&
        !item.promotion_guard?.blocked &&
        item.draft_activation_readiness?.ready
      ) {
        summary.ready += 1;
      }
      if (
        item.stage_status === "staged" &&
        !item.promotion_guard?.blocked &&
        item.draft_activation_readiness?.ready === false
      ) {
        summary.draftCleanup += 1;
      }

      return summary;
    },
    {
      total: 0,
      ready: 0,
      draftCleanup: 0,
      staged: 0,
      needsReview: 0,
      mapped: 0,
      skipped: 0,
      blocked: 0,
      promoted: 0,
    },
  );
}

function sellerMarketplaceStagedHeaders(params: {
  summary: ReturnType<typeof summarizeStagedItems>;
  importJobCount: number;
}) {
  return {
    "X-TCOS-Seller-Marketplace-Staged-Rows": String(params.summary.total),
    "X-TCOS-Seller-Marketplace-Staged-Ready": String(params.summary.ready),
    "X-TCOS-Seller-Marketplace-Staged-Draft-Cleanup": String(
      params.summary.draftCleanup,
    ),
    "X-TCOS-Seller-Marketplace-Staged-Needs-Review": String(
      params.summary.needsReview,
    ),
    "X-TCOS-Seller-Marketplace-Staged-Mapped": String(params.summary.mapped),
    "X-TCOS-Seller-Marketplace-Staged-Skipped": String(params.summary.skipped),
    "X-TCOS-Seller-Marketplace-Staged-Blocked": String(params.summary.blocked),
    "X-TCOS-Seller-Marketplace-Staged-Promoted": String(params.summary.promoted),
    "X-TCOS-Seller-Marketplace-Import-Jobs": String(params.importJobCount),
  };
}

function sellerMarketplaceStagedMutationHeaders(params: {
  action: "stage_batch" | "update";
  stagedCount?: number;
  skippedCount?: number;
  updatedCount?: number;
  stageStatus?: string | null;
  hasMore?: boolean;
}) {
  return {
    "X-TCOS-Seller-Marketplace-Staged-Mutation": params.action,
    "X-TCOS-Seller-Marketplace-Staged-Count": String(
      params.stagedCount ?? 0,
    ),
    "X-TCOS-Seller-Marketplace-Staged-Skipped": String(
      params.skippedCount ?? 0,
    ),
    "X-TCOS-Seller-Marketplace-Staged-Updated": String(
      params.updatedCount ?? 0,
    ),
    "X-TCOS-Seller-Marketplace-Staged-Target-Status":
      params.stageStatus || "metadata",
    "X-TCOS-Seller-Marketplace-Staged-Has-More": String(params.hasMore === true),
  };
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
    const { searchParams } = new URL(request.url);
    const limit = cleanLimit(searchParams.get("limit"), 100, 250);
    const stageStatus = cleanStageStatus(searchParams.get("stageStatus"));
    const importJobId = cleanText(searchParams.get("importJobId"));
    const importJobLimit = cleanLimit(searchParams.get("importJobLimit"));
    const importJobsQuery = supabase
      .from("seller_marketplace_import_jobs")
      .select(
        "id,status,row_count,staged_count,skipped_count,error_count,started_at,completed_at,updated_at,source_cursor,metadata",
      )
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .eq("provider", "ebay")
      .order("created_at", { ascending: false })
      .limit(importJobLimit);
    let stagedQuery = supabase
      .from("seller_marketplace_staged_items")
      .select(
        "id,import_job_id,provider,source_item_id,sku,title,quantity,price,currency,offer_status,listing_status,item_condition,image_url,stage_status,metadata,updated_at",
      )
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .eq("provider", "ebay");

    if (stageStatus) {
      stagedQuery = stagedQuery.eq("stage_status", stageStatus);
    } else {
      stagedQuery = stagedQuery
        .neq("stage_status", "skipped")
        .neq("stage_status", "mapped");
    }

    if (importJobId) {
      stagedQuery = stagedQuery.eq("import_job_id", importJobId);
    }

    const [stagedResult, importJobsResult] = await Promise.all([
      stagedQuery
        .order("updated_at", { ascending: false })
        .limit(limit),
      importJobsQuery,
    ]);

    if (stagedResult.error || importJobsResult.error) {
      const error = stagedResult.error || importJobsResult.error;

      if (error && isMissingSellerStagingTables(error)) {
        return unavailableResponse();
      }

      throw error;
    }

    const stagedItems = (stagedResult.data || []) as SellerMarketplaceStagedItemRow[];
    const importJobs =
      (importJobsResult.data || []) as SellerMarketplaceImportJobRow[];
    const importJobIds = Array.from(
      new Set(importJobs.map((job) => cleanText(job.id)).filter(Boolean)),
    ) as string[];
    const summaryStagedResult = importJobIds.length === 0
      ? { data: [] as SellerMarketplaceStagedItemRow[], error: null }
      : await supabase
          .from("seller_marketplace_staged_items")
          .select(
            "id,import_job_id,provider,source_item_id,sku,title,quantity,price,currency,offer_status,listing_status,item_condition,image_url,stage_status,metadata,updated_at",
          )
          .eq("account_id", account.id)
          .eq("store_id", storeId)
          .eq("provider", "ebay")
          .in("import_job_id", importJobIds)
          .limit(500);

    if (summaryStagedResult.error) {
      if (isMissingSellerStagingTables(summaryStagedResult.error)) {
        return unavailableResponse();
      }

      throw summaryStagedResult.error;
    }

    const summaryStagedItems =
      (summaryStagedResult.data || []) as SellerMarketplaceStagedItemRow[];
    const uniqueStageRows = Array.from(
      new Map(
        [...stagedItems, ...summaryStagedItems].map((item) => [item.id, item]),
      ).values(),
    );
    const skuValues = Array.from(
      new Set(uniqueStageRows.map((item) => cleanText(item.sku)).filter(Boolean)),
    ) as string[];
    const ebayItemIds = Array.from(
      new Set(
        uniqueStageRows
          .map((item) => {
            const metadata = metadataRecord(item.metadata);
            return (
              cleanText(metadata?.source_listing_id) || cleanText(item.source_item_id)
            );
          })
          .filter(Boolean),
      ),
    ) as string[];
    const { skuMatches, ebayItemMatches } = await loadDuplicateProducts({
      supabase,
      storeId,
      skuValues,
      ebayItemIds,
    });
    const enrichedStagedItems = enrichStagedItems({
      accountId: account.id,
      stagedItems,
      skuMatches,
      ebayItemMatches,
    });
    const enrichedSummaryStagedItems = enrichStagedItems({
      accountId: account.id,
      stagedItems: summaryStagedItems,
      skuMatches,
      ebayItemMatches,
    });
    const importJobSummaries = summarizeImportJobOutcomes(enrichedSummaryStagedItems);
    const stagedSummary = summarizeStagedItems(enrichedStagedItems);

    return Response.json(
      {
        success: true,
        stagedItems: enrichedStagedItems,
        latestImportJob: importJobs[0]
          ? {
              ...importJobs[0],
              current_summary: importJobs[0].id
                ? importJobSummaries[importJobs[0].id] || undefined
                : undefined,
            }
          : null,
        recentImportJobs: importJobs.map((job) => ({
          ...job,
          current_summary: job.id ? importJobSummaries[job.id] || undefined : undefined,
        })),
      },
      {
        headers: sellerMarketplaceStagedHeaders({
          summary: stagedSummary,
          importJobCount: importJobs.length,
        }),
      },
    );
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
      resetCursor: body.resetCursor === true,
    });

    return Response.json(
      {
        success: true,
        result,
      },
      {
        headers: sellerMarketplaceStagedMutationHeaders({
          action: "stage_batch",
          stagedCount: result.stagedCount,
          skippedCount: result.skippedCount,
          hasMore: result.hasMore,
        }),
      },
    );
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
    const stagedItemIds = cleanStageItemIds(body.stagedItemIds);
    const stageStatus = cleanStageStatus(body.stageStatus);
    const targetIds = stagedItemIds.length > 0
      ? stagedItemIds
      : stagedItemId
        ? [stagedItemId]
        : [];

    if (targetIds.length === 0) {
      return Response.json(
        { error: "A staged item ID is required." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const categoryHint = cleanCategoryHint(body.categoryHint);
    const authenticity = sanitizeAuthenticityProfile(body.authenticity);
    const authenticityError = validateAuthenticityProfile(authenticity);

    if (body.authenticity !== undefined && authenticityError) {
      return Response.json({ error: authenticityError }, { status: 400 });
    }

    if (body.duplicateTrash === true) {
      const { data: rows, error: rowsError } = await supabase
        .from("seller_marketplace_staged_items")
        .select(
          "id,import_job_id,provider,source_item_id,sku,title,quantity,price,currency,offer_status,listing_status,item_condition,image_url,stage_status,metadata,updated_at",
        )
        .in("id", targetIds)
        .eq("account_id", account.id)
        .eq("store_id", storeId)
        .eq("provider", "ebay");

      if (rowsError) {
        if (isMissingSellerStagingTables(rowsError)) {
          return unavailableResponse();
        }

        throw rowsError;
      }

      const stagedRows = (rows || []) as SellerMarketplaceStagedItemRow[];
      const skuValues = Array.from(
        new Set(stagedRows.map((item) => cleanText(item.sku)).filter(Boolean)),
      ) as string[];
      const ebayItemIds = Array.from(
        new Set(
          stagedRows
            .map((item) => {
              const metadata = metadataRecord(item.metadata);
              return (
                cleanText(metadata?.source_listing_id) ||
                cleanText(item.source_item_id)
              );
            })
            .filter(Boolean),
        ),
      ) as string[];
      const { skuMatches, ebayItemMatches } = await loadDuplicateProducts({
        supabase,
        storeId,
        skuValues,
        ebayItemIds,
      });
      const enrichedRows = enrichStagedItems({
        accountId: account.id,
        stagedItems: stagedRows,
        skuMatches,
        ebayItemMatches,
      });
      const exactDuplicateRows = enrichedRows.filter(isExactDuplicateTrashCandidate);
      const nowIso = new Date().toISOString();
      const updatedRows: SellerMarketplaceStagedItemRow[] = [];

      for (const row of exactDuplicateRows) {
        const existingMetadata = metadataRecord(row.metadata) || {};
        const { data: updated, error: updateError } = await supabase
          .from("seller_marketplace_staged_items")
          .update({
            stage_status: "skipped",
            metadata: {
              ...existingMetadata,
              duplicate_trash: true,
              trash_status: "pending_delete_verification",
              trash_kind: "duplicate",
              trash_note:
                "Exact eBay listing duplicate moved out of active staging. Verify before permanent delete.",
              duplicate_trash_at: nowIso,
              duplicate_trash_reasons: row.promotion_guard?.reasons || [],
              duplicate_trash_match_ids:
                row.promotion_guard?.matches
                  .filter((match) => match.matchType === "ebay_item_id")
                  .map((match) => match.id) || [],
              stage_trash: {
                kind: "duplicate",
                status: "pending_delete_verification",
                reason: "exact_ebay_item_match",
                trashed_at: nowIso,
                verify_before_permanent_delete: true,
              },
            },
            updated_at: nowIso,
          })
          .eq("id", row.id)
          .eq("account_id", account.id)
          .eq("store_id", storeId)
          .eq("provider", "ebay")
          .select(
            "id,import_job_id,provider,source_item_id,sku,title,quantity,price,currency,offer_status,listing_status,item_condition,image_url,stage_status,metadata,updated_at",
          )
          .single();

        if (updateError) {
          if (isMissingSellerStagingTables(updateError)) {
            return unavailableResponse();
          }

          throw updateError;
        }

        if (updated) {
          updatedRows.push(updated as SellerMarketplaceStagedItemRow);
        }
      }

      return Response.json(
        {
          success: true,
          stagedItem: updatedRows[0] || null,
          stagedItems: updatedRows,
          updatedCount: updatedRows.length,
          skippedCount: targetIds.length - updatedRows.length,
          duplicateTrashCount: updatedRows.length,
          skippedDuplicateTrashIds: targetIds.filter(
            (id) => !updatedRows.some((row) => row.id === id),
          ),
        },
        {
          headers: sellerMarketplaceStagedMutationHeaders({
            action: "update",
            updatedCount: updatedRows.length,
            stageStatus: "duplicate_trash",
          }),
        },
      );
    }

    if (!stageStatus && stagedItemIds.length > 0) {
      return Response.json(
        { error: "Bulk staged-item review edits must be saved one row at a time." },
        { status: 400 },
      );
    }

    if (!stageStatus && !stagedItemId) {
      return Response.json(
        { error: "A staged item ID is required for review edits." },
        { status: 400 },
      );
    }

    if (!stageStatus) {
      const { data: existingRow, error: existingError } = await supabase
        .from("seller_marketplace_staged_items")
        .select(
          "id,account_id,store_id,metadata",
        )
        .eq("id", stagedItemId)
        .eq("account_id", account.id)
        .eq("store_id", storeId)
        .single();

      if (existingError || !existingRow) {
        if (existingError && isMissingSellerStagingTables(existingError)) {
          return unavailableResponse();
        }

        return Response.json(
          { error: "Seller staged item was not found." },
          { status: 404 },
        );
      }

      const existingMetadata = metadataRecord(existingRow.metadata) || {};
      const nextMetadata: Record<string, unknown> = {
        ...existingMetadata,
      };

      if (body.categoryHint !== undefined) {
        nextMetadata.category_hint = categoryHint;
      }

      if (body.authenticity !== undefined) {
        nextMetadata.authenticity = {
          status: authenticity.status,
          autographSource: authenticity.autographSource,
          certProvider: authenticity.certProvider,
          certNumber: authenticity.certNumber,
          guaranteedAuthenticators: authenticity.guaranteedAuthenticators,
          provenanceEvidence: authenticity.provenanceEvidence,
          authenticityNotes: authenticity.authenticityNotes,
        };
      }

      const { data, error } = await supabase
        .from("seller_marketplace_staged_items")
        .update({
          metadata: nextMetadata,
          updated_at: new Date().toISOString(),
        })
        .eq("id", stagedItemId)
        .eq("account_id", account.id)
        .eq("store_id", storeId)
        .select(
          "id,import_job_id,provider,source_item_id,sku,title,quantity,price,currency,offer_status,listing_status,item_condition,image_url,stage_status,metadata,updated_at",
        );

      if (error) {
        if (isMissingSellerStagingTables(error)) {
          return unavailableResponse();
        }

        throw error;
      }

      const updatedCount = Array.isArray(data) ? data.length : 0;

      return Response.json(
        {
          success: true,
          stagedItem: Array.isArray(data) ? data[0] || null : null,
          stagedItems: data || [],
          updatedCount,
        },
        {
          headers: sellerMarketplaceStagedMutationHeaders({
            action: "update",
            updatedCount,
            stageStatus: null,
          }),
        },
      );
    }

    const { data, error } = await supabase
      .from("seller_marketplace_staged_items")
      .update({
        stage_status: stageStatus,
        updated_at: new Date().toISOString(),
      })
      .in("id", targetIds)
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .select(
        "id,import_job_id,provider,source_item_id,sku,title,quantity,price,currency,offer_status,listing_status,item_condition,image_url,stage_status,metadata,updated_at",
      );

    if (error) {
      if (isMissingSellerStagingTables(error)) {
        return unavailableResponse();
      }

      throw error;
    }

    const updatedCount = Array.isArray(data) ? data.length : 0;

    return Response.json(
      {
        success: true,
        stagedItem: Array.isArray(data) ? data[0] || null : null,
        stagedItems: data || [],
        updatedCount,
      },
      {
        headers: sellerMarketplaceStagedMutationHeaders({
          action: "update",
          updatedCount,
          stageStatus,
        }),
      },
    );
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
