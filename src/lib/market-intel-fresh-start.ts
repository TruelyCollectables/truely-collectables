import "server-only";

import { recalculateMarketIntelValue } from "./market-intel-comps";
import { createSupabaseServerClient } from "./supabase-server";

type JsonRecord = Record<string, unknown>;

type PurchaseRow = {
  id: string;
  purchase_number: number | string | null;
  collectible_identity_id: string | null;
  marketplace_id: string | null;
  source_listing_id: string | null;
  purchased_at: string;
  quantity_purchased: number | string | null;
  total_acquisition_cost: number | string | null;
  source_url: string | null;
  notes: string | null;
  metadata: JsonRecord | null;
};

export type MarketIntelFreshStartPurchase = {
  id: string;
  purchaseNumber: number;
  collectibleName: string;
  purchasedAt: string;
  quantity: number;
  totalCost: number;
  marketplaceName: string;
  marketplaceSlug: string;
  sourceUrl: string | null;
  isDemidov: boolean;
  isEbay: boolean;
  isLot: boolean;
  eligibleKeeper: boolean;
  keeperScore: number;
};

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function normalize(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeEbay(input: {
  marketplaceSlug: string;
  sourceUrl: string | null;
  metadata: JsonRecord;
}) {
  const metadataText = normalize(
    [
      input.metadata.beta_one_purchase_source,
      input.metadata.acquisition_channel,
      input.metadata.source,
      input.metadata.source_adapter,
      input.metadata.external_order_id,
    ].join(" "),
  );
  return (
    normalize(input.marketplaceSlug) === "ebay" ||
    normalize(input.sourceUrl).includes("ebay com") ||
    metadataText.includes("ebay")
  );
}

export async function getMarketIntelFreshStartPreview() {
  const supabase = createSupabaseServerClient({ admin: true });
  const [watchResult, purchaseResult] = await Promise.all([
    supabase.from("tcos_mi_watchlist").select("id", { count: "exact" }),
    supabase
      .from("tcos_mi_purchase_lots")
      .select(
        "id,purchase_number,collectible_identity_id,marketplace_id,source_listing_id,purchased_at,quantity_purchased,total_acquisition_cost,source_url,notes,metadata",
      )
      .order("purchased_at", { ascending: true }),
  ]);

  if (watchResult.error) throw new Error(watchResult.error.message);
  if (purchaseResult.error) throw new Error(purchaseResult.error.message);

  const purchaseRows = (purchaseResult.data || []) as PurchaseRow[];
  const identityIds = Array.from(
    new Set(
      purchaseRows
        .map((row) => row.collectible_identity_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const marketplaceIds = Array.from(
    new Set(
      purchaseRows
        .map((row) => row.marketplace_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const [identityResult, marketplaceResult] = await Promise.all([
    identityIds.length
      ? supabase
          .from("tcos_mi_collectible_identities")
          .select("id,display_name")
          .in("id", identityIds)
      : Promise.resolve({ data: [], error: null }),
    marketplaceIds.length
      ? supabase
          .from("tcos_mi_marketplaces")
          .select("id,name,slug")
          .in("id", marketplaceIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (identityResult.error) throw new Error(identityResult.error.message);
  if (marketplaceResult.error) throw new Error(marketplaceResult.error.message);

  const identityById = new Map(
    (identityResult.data || []).map((row) => [String(row.id), String(row.display_name)]),
  );
  const marketplaceById = new Map(
    (marketplaceResult.data || []).map((row) => [
      String(row.id),
      { name: String(row.name), slug: String(row.slug) },
    ]),
  );

  const purchases = purchaseRows.map((row): MarketIntelFreshStartPurchase => {
    const metadata = recordValue(row.metadata);
    const collectibleName = row.collectible_identity_id
      ? identityById.get(row.collectible_identity_id) || "Unmatched collectible"
      : "Unmatched collectible";
    const marketplace = row.marketplace_id
      ? marketplaceById.get(row.marketplace_id) || { name: "Unknown source", slug: "unknown" }
      : { name: "Unknown source", slug: "unknown" };
    const quantity = Math.max(1, Math.round(numberValue(row.quantity_purchased, 1)));
    const researchText = normalize(
      [
        collectibleName,
        row.notes,
        metadata.source_listing_title,
        metadata.external_order_id,
        row.source_url,
      ].join(" "),
    );
    const isDemidov = researchText.includes("ivan demidov") || researchText.includes("demidov");
    const isEbay = looksLikeEbay({
      marketplaceSlug: marketplace.slug,
      sourceUrl: row.source_url,
      metadata,
    });
    const isLot = quantity > 1 || researchText.includes(" lot ") || researchText.endsWith(" lot");
    const eligibleKeeper = isDemidov && isEbay;
    const keeperScore =
      (eligibleKeeper ? 100 : 0) +
      (isLot ? 30 : 0) +
      Math.min(20, quantity) +
      (metadata.purchase_inbox_id ? 10 : 0);

    return {
      id: String(row.id),
      purchaseNumber: numberValue(row.purchase_number),
      collectibleName,
      purchasedAt: String(row.purchased_at),
      quantity,
      totalCost: numberValue(row.total_acquisition_cost),
      marketplaceName: marketplace.name,
      marketplaceSlug: marketplace.slug,
      sourceUrl: row.source_url ? String(row.source_url) : null,
      isDemidov,
      isEbay,
      isLot,
      eligibleKeeper,
      keeperScore,
    };
  });

  const suggestedKeeper = [...purchases]
    .filter((purchase) => purchase.eligibleKeeper)
    .sort(
      (left, right) =>
        right.keeperScore - left.keeperScore ||
        right.quantity - left.quantity ||
        left.purchaseNumber - right.purchaseNumber,
    )[0] || null;

  return {
    watchTargetCount: watchResult.count || 0,
    purchases,
    suggestedKeeperId: suggestedKeeper?.id || null,
    eligibleKeeperCount: purchases.filter((purchase) => purchase.eligibleKeeper).length,
  };
}

async function deleteByIds(
  table: string,
  column: string,
  ids: string[],
  label: string,
) {
  if (ids.length === 0) return 0;
  const supabase = createSupabaseServerClient({ admin: true });
  const { error, count } = await supabase
    .from(table)
    .delete({ count: "exact" })
    .in(column, ids);
  if (error) throw new Error(`Unable to delete ${label}: ${error.message}`);
  return count || 0;
}

export async function resetMarketIntelSearchesAndPurchases(input: {
  keepPurchaseId: string;
  confirmation: string;
}) {
  if (input.confirmation.trim() !== "RESET MARKET INTEL") {
    throw new Error("Type RESET MARKET INTEL exactly to confirm the cleanup.");
  }

  const preview = await getMarketIntelFreshStartPreview();
  const keeper = preview.purchases.find((purchase) => purchase.id === input.keepPurchaseId);
  if (!keeper) throw new Error("Choose the Demidov eBay lot to keep before resetting.");
  if (!keeper.eligibleKeeper) {
    throw new Error("The protected purchase must be an Ivan Demidov purchase from eBay.");
  }

  const deletePurchases = preview.purchases.filter(
    (purchase) => purchase.id !== keeper.id,
  );
  const deletePurchaseIds = deletePurchases.map((purchase) => purchase.id);
  const affectedIdentityIds = new Set<string>();
  const supabase = createSupabaseServerClient({ admin: true });

  for (const purchase of deletePurchases) {
    const { data, error } = await supabase
      .from("tcos_mi_purchase_lots")
      .select("collectible_identity_id")
      .eq("id", purchase.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data?.collectible_identity_id) {
      affectedIdentityIds.add(String(data.collectible_identity_id));
    }
  }

  const { data: inboxRows, error: inboxLoadError } = deletePurchaseIds.length
    ? await supabase
        .from("tcos_mi_purchase_inbox")
        .select("id,identity_candidate_id,purchase_lot_id")
        .in("purchase_lot_id", deletePurchaseIds)
    : { data: [], error: null };
  if (inboxLoadError && !/does not exist|schema cache/i.test(inboxLoadError.message)) {
    throw new Error(`Unable to load linked Purchase Inbox rows: ${inboxLoadError.message}`);
  }

  const inboxIds = (inboxRows || []).map((row) => String(row.id));
  const candidateIds = (inboxRows || [])
    .map((row) => (row.identity_candidate_id ? String(row.identity_candidate_id) : null))
    .filter((value): value is string => Boolean(value));

  const { data: receiptComps, error: receiptCompError } = await supabase
    .from("tcos_mi_sold_comps")
    .select("id,collectible_identity_id,metadata")
    .limit(5000);
  if (receiptCompError) throw new Error(receiptCompError.message);

  const purchaseIdSet = new Set(deletePurchaseIds);
  const inboxIdSet = new Set(inboxIds);
  const receiptCompIds = (receiptComps || [])
    .filter((row) => {
      const metadata = recordValue(row.metadata);
      return (
        purchaseIdSet.has(String(metadata.purchase_lot_id || "")) ||
        inboxIdSet.has(String(metadata.purchase_inbox_id || ""))
      );
    })
    .map((row) => {
      if (row.collectible_identity_id) {
        affectedIdentityIds.add(String(row.collectible_identity_id));
      }
      return String(row.id);
    });

  const { error: watchDeleteError, count: watchTargetsDeleted } = await supabase
    .from("tcos_mi_watchlist")
    .delete({ count: "exact" })
    .not("id", "is", null);
  if (watchDeleteError) throw new Error(`Unable to reset search targets: ${watchDeleteError.message}`);

  const receiptCompsDeleted = await deleteByIds(
    "tcos_mi_sold_comps",
    "id",
    receiptCompIds,
    "purchase-receipt comps",
  );
  const salesDeleted = await deleteByIds(
    "tcos_mi_inventory_sales",
    "purchase_lot_id",
    deletePurchaseIds,
    "linked inventory sales",
  );
  const inboxDeleted = await deleteByIds(
    "tcos_mi_purchase_inbox",
    "purchase_lot_id",
    deletePurchaseIds,
    "linked Purchase Inbox rows",
  );
  const candidatesDeleted = await deleteByIds(
    "tcos_mi_identity_candidates",
    "id",
    candidateIds,
    "linked purchase-review candidates",
  );
  const purchasesDeleted = await deleteByIds(
    "tcos_mi_purchase_lots",
    "id",
    deletePurchaseIds,
    "tracked purchase positions",
  );

  const marketWarnings: string[] = [];
  for (const identityId of affectedIdentityIds) {
    try {
      await recalculateMarketIntelValue(identityId);
    } catch (error) {
      marketWarnings.push(
        error instanceof Error ? error.message : `Unable to recalculate ${identityId}.`,
      );
    }
  }

  return {
    keeper,
    watchTargetsDeleted: watchTargetsDeleted || 0,
    purchasesDeleted,
    salesDeleted,
    inboxDeleted,
    candidatesDeleted,
    receiptCompsDeleted,
    recalculatedMarkets: affectedIdentityIds.size - marketWarnings.length,
    marketWarnings,
  };
}
