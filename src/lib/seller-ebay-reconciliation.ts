import type { SupabaseClient } from "@supabase/supabase-js";
import { getSellerEbayAccessToken } from "./seller-ebay";

const BATCH_SIZE = 25;

type SellerProductRow = {
  id: number;
  sku: string | null;
  title: string | null;
  price: number | string | null;
  quantity: number | null;
  ebay_item_id: string | null;
};

type SellerInventoryRow = {
  id: string;
  legacy_product_id: number | null;
  status: string | null;
  quantity: number | null;
};

type SellerStagedRow = {
  id: string;
  source_item_id: string | null;
  sku: string | null;
  title: string | null;
  quantity: number | null;
  price: number | string | null;
  offer_status: string | null;
  listing_status: string | null;
  stage_status: string | null;
  metadata: Record<string, unknown> | null;
};

type ConnectionStateRow = {
  id: string;
  import_cursor: Record<string, unknown> | null;
  provider_metadata: Record<string, unknown> | null;
};

export type SellerEbayRemoteState = {
  found: boolean;
  quantity: number | null;
  price: number | null;
  offerStatus: string | null;
  listingStatus: string | null;
  listingId: string | null;
  listingOnHold: boolean;
  soldQuantity: number | null;
  warning: string | null;
};

type QuantityCeilingRow = {
  inventory_item_id: string | null;
  previous_quantity: number | null;
  new_quantity: number | null;
  inventory_status: string | null;
};

export type SellerEbayReconciliationRun = {
  id: string;
  status: string;
  cursorOffset: number;
  scannedCount: number;
  matchedCount: number;
  quantityReducedCount: number;
  soldCount: number;
  reviewCount: number;
  failedCount: number;
  startedAt: string | null;
  completedAt: string | null;
  summary: Record<string, unknown>;
};

export type SellerEbayReconciliationStatus = {
  linkedCount: number;
  latestRun: SellerEbayReconciliationRun | null;
  recentRuns: SellerEbayReconciliationRun[];
};

export type SellerEbayReconciliationResult = {
  runId: string;
  status: string;
  offset: number;
  nextOffset: number;
  hasMore: boolean;
  totalLinked: number;
  scannedCount: number;
  matchedCount: number;
  quantityReducedCount: number;
  soldCount: number;
  reviewCount: number;
  failedCount: number;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonNegativeInteger(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function nullableNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function moneyNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function isRemoteSaleable(remote: SellerEbayRemoteState) {
  return (
    remote.found &&
    remote.quantity !== null &&
    remote.quantity > 0 &&
    remote.offerStatus === "PUBLISHED" &&
    remote.listingStatus === "ACTIVE" &&
    remote.listingOnHold !== true
  );
}

function remoteArchiveReasons(remote: SellerEbayRemoteState) {
  const reasons: string[] = [];

  if (!remote.found) reasons.push("remote_inventory_item_not_found");
  if (remote.warning) reasons.push(remote.warning);
  if (remote.quantity !== null && remote.quantity <= 0) {
    reasons.push("sold_or_zero_quantity");
  }
  if (remote.offerStatus && remote.offerStatus !== "PUBLISHED") {
    reasons.push(`offer_${remote.offerStatus.toLowerCase()}`);
  }
  if (remote.listingStatus && remote.listingStatus !== "ACTIVE") {
    reasons.push(`listing_${remote.listingStatus.toLowerCase()}`);
  }
  if (remote.listingOnHold) reasons.push("listing_on_hold");

  return Array.from(new Set(reasons));
}

function ebayApiBase(environment: string) {
  return environment === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
}

function ebayHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Accept-Language": "en-US",
  };
}

function mapRun(row: any): SellerEbayReconciliationRun {
  return {
    id: String(row.id),
    status: String(row.status || "processing"),
    cursorOffset: nonNegativeInteger(row.cursor_offset),
    scannedCount: nonNegativeInteger(row.scanned_count),
    matchedCount: nonNegativeInteger(row.matched_count),
    quantityReducedCount: nonNegativeInteger(row.quantity_reduced_count),
    soldCount: nonNegativeInteger(row.sold_count),
    reviewCount: nonNegativeInteger(row.review_count),
    failedCount: nonNegativeInteger(row.failed_count),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    summary: recordValue(row.summary),
  };
}

export async function fetchSellerEbayRemoteState(params: {
  apiBase: string;
  accessToken: string;
  sku: string;
  expectedListingId: string | null;
}): Promise<SellerEbayRemoteState> {
  const headers = ebayHeaders(params.accessToken);
  const itemResponse = await fetch(
    `${params.apiBase}/sell/inventory/v1/inventory_item/${encodeURIComponent(params.sku)}`,
    { headers },
  );
  const itemData = await itemResponse.json().catch(() => ({}));

  if (itemResponse.status === 404) {
    return {
      found: false,
      quantity: null,
      price: null,
      offerStatus: null,
      listingStatus: null,
      listingId: null,
      listingOnHold: false,
      soldQuantity: null,
      warning: "remote_inventory_item_not_found",
    };
  }

  if (!itemResponse.ok) {
    throw new Error(
      itemData?.errors?.[0]?.message ||
        itemData?.message ||
        `eBay inventory lookup failed with ${itemResponse.status}`,
    );
  }

  const quantity = nullableNumber(
    itemData?.availability?.shipToLocationAvailability?.quantity,
  );
  const offerResponse = await fetch(
    `${params.apiBase}/sell/inventory/v1/offer?sku=${encodeURIComponent(params.sku)}`,
    { headers },
  );
  const offerData = await offerResponse.json().catch(() => ({}));

  if (!offerResponse.ok) {
    return {
      found: true,
      quantity,
      price: null,
      offerStatus: null,
      listingStatus: null,
      listingId: null,
      listingOnHold: false,
      soldQuantity: null,
      warning: `offer_lookup_failed_${offerResponse.status}`,
    };
  }

  const offers = Array.isArray(offerData?.offers) ? offerData.offers : [];
  const matchingOffer = params.expectedListingId
    ? offers.find(
        (offer: any) =>
          String(offer?.listing?.listingId || "") === params.expectedListingId,
      )
    : null;
  const offer = matchingOffer || offers[0] || null;
  const price = nullableNumber(offer?.pricingSummary?.price?.value);

  return {
    found: true,
    quantity,
    price,
    offerStatus: offer?.status ? String(offer.status) : null,
    listingStatus: offer?.listing?.listingStatus
      ? String(offer.listing.listingStatus)
      : null,
    listingId: offer?.listing?.listingId
      ? String(offer.listing.listingId)
      : null,
    listingOnHold: offer?.listing?.listingOnHold === true,
    soldQuantity: nullableNumber(offer?.listing?.soldQuantity),
    warning: offers.length === 0 ? "offer_not_found" : null,
  };
}

async function processInChunks<T>(
  values: T[],
  worker: (value: T) => Promise<void>,
) {
  for (let offset = 0; offset < values.length; offset += 5) {
    await Promise.all(values.slice(offset, offset + 5).map(worker));
  }
}

export async function loadSellerEbayReconciliationStatus(params: {
  supabase: SupabaseClient;
  accountId: string;
  storeId: string;
}): Promise<SellerEbayReconciliationStatus> {
  const [countResult, runsResult] = await Promise.all([
    params.supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("store_id", params.storeId)
      .eq("seller_account_id", params.accountId)
      .not("ebay_item_id", "is", null),
    params.supabase
      .from("seller_marketplace_reconciliation_runs")
      .select(
        "id,status,cursor_offset,scanned_count,matched_count,quantity_reduced_count,sold_count,review_count,failed_count,summary,started_at,completed_at",
      )
      .eq("store_id", params.storeId)
      .eq("account_id", params.accountId)
      .eq("provider", "ebay")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  if (countResult.error) throw countResult.error;
  if (runsResult.error) throw runsResult.error;

  const recentRuns = (runsResult.data || []).map(mapRun);

  return {
    linkedCount: countResult.count || 0,
    latestRun: recentRuns[0] || null,
    recentRuns,
  };
}

export async function reconcileSellerEbayInventoryBatch(params: {
  supabase: SupabaseClient;
  accountId: string;
  storeId: string;
  resetCursor?: boolean;
  source?: "seller_manual" | "scheduled_cron";
}): Promise<SellerEbayReconciliationResult> {
  const startedAt = new Date().toISOString();
  const source = params.source || "seller_manual";
  const auth = await getSellerEbayAccessToken({
    supabase: params.supabase,
    accountId: params.accountId,
    storeId: params.storeId,
  });
  const { data: connection, error: connectionError } = await params.supabase
    .from("seller_marketplace_connections")
    .select("id,import_cursor,provider_metadata")
    .eq("id", auth.connectionId)
    .eq("account_id", params.accountId)
    .eq("store_id", params.storeId)
    .eq("provider", "ebay")
    .single();

  if (connectionError || !connection) {
    throw connectionError || new Error("Seller eBay connection was not found.");
  }

  const connectionState = connection as unknown as ConnectionStateRow;
  const importCursor = recordValue(connectionState.import_cursor);
  const offset = params.resetCursor
    ? 0
    : nonNegativeInteger(importCursor.reconcile_next_offset);
  const stagedOffset = params.resetCursor
    ? 0
    : nonNegativeInteger(importCursor.reconcile_stage_next_offset);
  const { count: totalLinked, error: countError } = await params.supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("store_id", params.storeId)
    .eq("seller_account_id", params.accountId)
    .not("ebay_item_id", "is", null);

  if (countError) throw countError;

  const { count: totalStaged, error: stagedCountError } = await params.supabase
    .from("seller_marketplace_staged_items")
    .select("id", { count: "exact", head: true })
    .eq("store_id", params.storeId)
    .eq("account_id", params.accountId)
    .eq("provider", "ebay")
    .in("stage_status", ["staged", "needs_review"]);

  if (stagedCountError) throw stagedCountError;

  const { data: run, error: runError } = await params.supabase
    .from("seller_marketplace_reconciliation_runs")
    .insert({
      account_id: params.accountId,
      store_id: params.storeId,
      connection_id: auth.connectionId,
      provider: "ebay",
      status: "processing",
      cursor_offset: offset,
      started_at: startedAt,
      summary: {
        batch_size: BATCH_SIZE,
        reset_cursor: params.resetCursor === true,
        request_source: source,
        staged_batch_offset: stagedOffset,
      },
    })
    .select("id")
    .single();

  if (runError || !run?.id) {
    throw runError || new Error("Could not start seller eBay reconciliation.");
  }

  const runId = String(run.id);
  await params.supabase
    .from("seller_marketplace_connections")
    .update({
      sync_status: "syncing",
      last_sync_started_at: startedAt,
      last_sync_error: null,
      updated_at: startedAt,
    })
    .eq("id", auth.connectionId)
    .eq("account_id", params.accountId)
    .eq("store_id", params.storeId);

  try {
    const { data: productData, error: productError } = await params.supabase
      .from("products")
      .select("id,sku,title,price,quantity,ebay_item_id")
      .eq("store_id", params.storeId)
      .eq("seller_account_id", params.accountId)
      .not("ebay_item_id", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (productError) throw productError;

    const products = (productData || []) as SellerProductRow[];
    const productIds = products.map((product) => product.id);
    const { data: inventoryData, error: inventoryError } =
      productIds.length === 0
        ? { data: [], error: null }
        : await params.supabase
            .from("inventory_items")
            .select("id,legacy_product_id,status,quantity")
            .eq("store_id", params.storeId)
            .eq("seller_account_id", params.accountId)
            .in("legacy_product_id", productIds);

    if (inventoryError) throw inventoryError;

    const inventoryByProductId = new Map(
      ((inventoryData || []) as SellerInventoryRow[])
        .filter((item) => item.legacy_product_id)
        .map((item) => [item.legacy_product_id as number, item]),
    );
    const counters = {
      matched: 0,
      quantityReduced: 0,
      sold: 0,
      review: 0,
      failed: 0,
    };
    const apiBase = ebayApiBase(auth.ebayEnvironment);

    await processInChunks(products, async (product) => {
      const inventory = inventoryByProductId.get(product.id) || null;
      const sku = String(product.sku || "").trim();
      const listingId = String(product.ebay_item_id || "").trim() || null;
      const localPrice = moneyNumber(product.price);
      const baseEvent = {
        run_id: runId,
        account_id: params.accountId,
        store_id: params.storeId,
        connection_id: auth.connectionId,
        provider: "ebay",
        legacy_product_id: product.id,
        inventory_item_id: inventory?.id || null,
        sku: sku || null,
        provider_listing_id: listingId,
        local_quantity_before: nonNegativeInteger(product.quantity),
        local_price: localPrice,
      };

      if (!sku) {
        counters.review += 1;
        await params.supabase
          .from("seller_marketplace_reconciliation_events")
          .insert({
            ...baseEvent,
            decision: "needs_review",
            reason_codes: ["missing_sku"],
            local_quantity_after: nonNegativeInteger(product.quantity),
          });
        return;
      }

      try {
        const remote = await fetchSellerEbayRemoteState({
          apiBase,
          accessToken: auth.accessToken,
          sku,
          expectedListingId: listingId,
        });
        const reasons: string[] = [];
        const listingMismatch =
          Boolean(remote.listingId && listingId && remote.listingId !== listingId);
        const priceMismatch =
          remote.price !== null && Math.abs(remote.price - localPrice) >= 0.01;
        const canSyncPriceFromEbay =
          priceMismatch && isRemoteSaleable(remote) && !listingMismatch;
        let priceSyncedFromEbay = false;

        if (!remote.found) reasons.push("remote_inventory_item_not_found");
        if (remote.warning) reasons.push(remote.warning);
        if (listingMismatch) {
          reasons.push("listing_id_mismatch");
        }
        if (remote.offerStatus && remote.offerStatus !== "PUBLISHED") {
          reasons.push("offer_not_published");
        }
        if (
          remote.listingStatus &&
          !["ACTIVE", "OUT_OF_STOCK"].includes(remote.listingStatus)
        ) {
          reasons.push(`listing_${remote.listingStatus.toLowerCase()}`);
        }
        if (remote.listingOnHold) reasons.push("listing_on_hold");
        if (priceMismatch && !canSyncPriceFromEbay) {
          reasons.push("price_mismatch");
        }
        if (remote.quantity === null) reasons.push("remote_quantity_missing");
        if (
          remote.quantity !== null &&
          remote.quantity > nonNegativeInteger(product.quantity)
        ) {
          reasons.push("remote_quantity_higher_no_auto_increase");
        }
        if (!inventory) reasons.push("inventory_item_missing");

        let quantityResult: QuantityCeilingRow | null = null;

        if (remote.quantity !== null && remote.found && !listingMismatch) {
          const { data: ceilingData, error: ceilingError } = await params.supabase
            .rpc("tcos_apply_seller_ebay_quantity_ceiling", {
              p_store_id: params.storeId,
              p_account_id: params.accountId,
              p_legacy_product_id: product.id,
              p_remote_quantity: remote.quantity,
              p_reconciliation_metadata: {
                run_id: runId,
                provider_listing_id: listingId,
                remote_quantity: remote.quantity,
                remote_price: remote.price,
                offer_status: remote.offerStatus,
                listing_status: remote.listingStatus,
                sold_quantity: remote.soldQuantity,
              },
            });

          if (ceilingError) throw ceilingError;
          quantityResult = (Array.isArray(ceilingData)
            ? ceilingData[0]
            : ceilingData) as QuantityCeilingRow | null;
          counters.matched += 1;
        }

        if (canSyncPriceFromEbay && remote.price !== null) {
          const priceSyncedAt = new Date().toISOString();
          const { error: productPriceError } = await params.supabase
            .from("products")
            .update({
              price: remote.price,
              last_seen_at: priceSyncedAt,
            })
            .eq("id", product.id)
            .eq("store_id", params.storeId)
            .eq("seller_account_id", params.accountId);

          if (productPriceError) throw productPriceError;

          if (inventory?.id) {
            const { error: inventoryPriceError } = await params.supabase
              .from("inventory_items")
              .update({
                price: remote.price,
                updated_at: priceSyncedAt,
              })
              .eq("id", inventory.id)
              .eq("store_id", params.storeId)
              .eq("seller_account_id", params.accountId);

            if (inventoryPriceError) throw inventoryPriceError;
          }

          priceSyncedFromEbay = true;
        }

        const previousQuantity = nonNegativeInteger(
          quantityResult?.previous_quantity ?? product.quantity,
        );
        const nextQuantity = nonNegativeInteger(
          quantityResult?.new_quantity ?? product.quantity,
        );
        let decision: "unchanged" | "quantity_reduced" | "sold" | "needs_review" =
          reasons.length > 0 ? "needs_review" : "unchanged";

        if (nextQuantity < previousQuantity) {
          if (nextQuantity === 0) {
            decision = "sold";
            counters.sold += 1;
          } else {
            decision = "quantity_reduced";
            counters.quantityReduced += 1;
          }
        }

        if (reasons.length > 0) counters.review += 1;

        const { error: eventError } = await params.supabase
          .from("seller_marketplace_reconciliation_events")
          .insert({
            ...baseEvent,
            inventory_item_id:
              quantityResult?.inventory_item_id || inventory?.id || null,
            decision,
            reason_codes: Array.from(
              new Set([
                ...reasons,
                ...(priceSyncedFromEbay ? ["price_synced_from_ebay"] : []),
              ]),
            ),
            remote_quantity: remote.quantity,
            local_quantity_after: nextQuantity,
            remote_price: remote.price,
            offer_status: remote.offerStatus,
            listing_status: remote.listingStatus,
            sold_quantity: remote.soldQuantity,
            metadata: {
              remote_found: remote.found,
              price_synced_from_ebay: priceSyncedFromEbay,
              local_price_before: localPrice,
              local_price_after: priceSyncedFromEbay ? remote.price : localPrice,
              inventory_status:
                quantityResult?.inventory_status || inventory?.status || null,
            },
          });

        if (eventError) throw eventError;

        if (remote.quantity !== null) {
          const stagedPayload: Record<string, unknown> = {
            quantity: remote.quantity,
            offer_status: remote.offerStatus,
            listing_status: remote.listingStatus,
            updated_at: new Date().toISOString(),
          };

          if (remote.price !== null) {
            stagedPayload.price = remote.price;
          }

          let stagedUpdate = params.supabase
            .from("seller_marketplace_staged_items")
            .update(stagedPayload)
            .eq("account_id", params.accountId)
            .eq("store_id", params.storeId)
            .eq("provider", "ebay");

          stagedUpdate = listingId
            ? stagedUpdate.eq("source_item_id", listingId)
            : stagedUpdate.eq("sku", sku);
          await stagedUpdate;
        }
      } catch (error: any) {
        counters.failed += 1;
        await params.supabase
          .from("seller_marketplace_reconciliation_events")
          .insert({
            ...baseEvent,
            decision: "failed",
            reason_codes: ["remote_lookup_or_apply_failed"],
            local_quantity_after: nonNegativeInteger(product.quantity),
            metadata: {
              error: String(error.message || "Reconciliation failed").slice(0, 500),
            },
          });
      }
    });

    const { data: stagedData, error: stagedError } = await params.supabase
      .from("seller_marketplace_staged_items")
      .select(
        "id,source_item_id,sku,title,quantity,price,offer_status,listing_status,stage_status,metadata",
      )
      .eq("store_id", params.storeId)
      .eq("account_id", params.accountId)
      .eq("provider", "ebay")
      .in("stage_status", ["staged", "needs_review"])
      .order("updated_at", { ascending: false })
      .range(stagedOffset, stagedOffset + BATCH_SIZE - 1);

    if (stagedError) throw stagedError;

    const stagedRows = (stagedData || []) as SellerStagedRow[];
    let stagedArchivedCount = 0;
    let stagedRefreshedCount = 0;
    let stagedReviewCount = 0;

    await processInChunks(stagedRows, async (staged) => {
      const sku = String(staged.sku || "").trim();
      const listingId = String(staged.source_item_id || "").trim() || null;
      const baseEvent = {
        run_id: runId,
        account_id: params.accountId,
        store_id: params.storeId,
        connection_id: auth.connectionId,
        provider: "ebay",
        legacy_product_id: null,
        inventory_item_id: null,
        sku: sku || null,
        provider_listing_id: listingId,
        local_quantity_before: nonNegativeInteger(staged.quantity),
        local_price: moneyNumber(staged.price),
      };

      if (!sku) {
        counters.review += 1;
        stagedReviewCount += 1;
        await params.supabase
          .from("seller_marketplace_reconciliation_events")
          .insert({
            ...baseEvent,
            decision: "needs_review",
            reason_codes: ["staged_row_missing_sku"],
            local_quantity_after: nonNegativeInteger(staged.quantity),
            metadata: {
              staged_item_id: staged.id,
              source: "seller_marketplace_staged_items",
            },
          });
        return;
      }

      try {
        const remote = await fetchSellerEbayRemoteState({
          apiBase,
          accessToken: auth.accessToken,
          sku,
          expectedListingId: listingId,
        });
        const reasons = remoteArchiveReasons(remote);
        const saleable = isRemoteSaleable(remote);
        const nowIso = new Date().toISOString();
        const metadata = recordValue(staged.metadata);
        const nextMetadata = {
          ...metadata,
          ebay_reconciliation: {
            remote_found: remote.found,
            remote_quantity: remote.quantity,
            remote_price: remote.price,
            offer_status: remote.offerStatus,
            listing_status: remote.listingStatus,
            sold_quantity: remote.soldQuantity,
            listing_on_hold: remote.listingOnHold,
            reconciled_at: nowIso,
            run_id: runId,
          },
        };

        if (!saleable) {
          const archiveReason = reasons[0] || "not_currently_saleable";
          stagedArchivedCount += 1;
          counters.sold += 1;
          await params.supabase
            .from("seller_marketplace_staged_items")
            .update({
              quantity: remote.quantity ?? staged.quantity ?? 0,
              price: remote.price ?? staged.price,
              offer_status: remote.offerStatus,
              listing_status: remote.listingStatus,
              stage_status: "skipped",
              metadata: {
                ...nextMetadata,
                import_classification: "archived_not_currently_for_sale",
                archive_reason: archiveReason,
                archive_reasons: reasons,
                comp_evidence_candidate: true,
                archived_from_stage_status: staged.stage_status,
                archived_at: nowIso,
                archive_note:
                  "Moved out of active seller working table by eBay reconciliation because the remote listing is not currently active and saleable.",
              },
              updated_at: nowIso,
            })
            .eq("id", staged.id)
            .eq("account_id", params.accountId)
            .eq("store_id", params.storeId)
            .eq("provider", "ebay");
        } else {
          stagedRefreshedCount += 1;
          counters.matched += 1;
          await params.supabase
            .from("seller_marketplace_staged_items")
            .update({
              quantity: remote.quantity,
              price: remote.price ?? staged.price,
              offer_status: remote.offerStatus,
              listing_status: remote.listingStatus,
              metadata: nextMetadata,
              updated_at: nowIso,
            })
            .eq("id", staged.id)
            .eq("account_id", params.accountId)
            .eq("store_id", params.storeId)
            .eq("provider", "ebay");
        }

        await params.supabase
          .from("seller_marketplace_reconciliation_events")
          .insert({
            ...baseEvent,
            decision: saleable ? "unchanged" : "sold",
            reason_codes: saleable ? [] : reasons,
            remote_quantity: remote.quantity,
            local_quantity_after: saleable
              ? remote.quantity
              : nonNegativeInteger(remote.quantity),
            remote_price: remote.price,
            offer_status: remote.offerStatus,
            listing_status: remote.listingStatus,
            sold_quantity: remote.soldQuantity,
            metadata: {
              staged_item_id: staged.id,
              source: "seller_marketplace_staged_items",
              saleable,
            },
          });
      } catch (error: any) {
        counters.failed += 1;
        await params.supabase
          .from("seller_marketplace_reconciliation_events")
          .insert({
            ...baseEvent,
            decision: "failed",
            reason_codes: ["staged_row_remote_lookup_failed"],
            local_quantity_after: nonNegativeInteger(staged.quantity),
            metadata: {
              staged_item_id: staged.id,
              source: "seller_marketplace_staged_items",
              error: String(error.message || "Staged reconciliation failed").slice(
                0,
                500,
              ),
            },
          });
      }
    });

    const scannedCount = products.length + stagedRows.length;
    const nextRawOffset = offset + products.length;
    const linkedCount = totalLinked || 0;
    const hasMoreProducts = nextRawOffset < linkedCount;
    const nextOffset = hasMoreProducts ? nextRawOffset : 0;
    const stagedCount = totalStaged || 0;
    const nextStagedRawOffset = stagedOffset + stagedRows.length;
    const hasMoreStaged = nextStagedRawOffset < stagedCount;
    const nextStagedOffset = hasMoreStaged ? nextStagedRawOffset : 0;
    const hasMore = hasMoreProducts || hasMoreStaged;
    const completedAt = new Date().toISOString();
    const status = counters.failed > 0 ? "completed_with_errors" : "completed";
    const summary = {
      total_linked: linkedCount,
      total_staged: stagedCount,
      offset,
      next_offset: nextOffset,
      staged_offset: stagedOffset,
      staged_next_offset: nextStagedOffset,
      has_more: hasMore,
      has_more_products: hasMoreProducts,
      has_more_staged: hasMoreStaged,
      batch_size: BATCH_SIZE,
      request_source: source,
      staged_scanned_count: stagedRows.length,
      staged_refreshed_count: stagedRefreshedCount,
      staged_archived_count: stagedArchivedCount,
      staged_review_count: stagedReviewCount,
      outside_sale_fee_applied: false,
      auto_increase_enabled: false,
    };

    await params.supabase
      .from("seller_marketplace_reconciliation_runs")
      .update({
        status,
        scanned_count: scannedCount,
        matched_count: counters.matched,
        quantity_reduced_count: counters.quantityReduced,
        sold_count: counters.sold,
        review_count: counters.review,
        failed_count: counters.failed,
        summary,
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", runId);

    await params.supabase
      .from("seller_marketplace_connections")
      .update({
        sync_status: status,
        last_sync_completed_at: completedAt,
        last_sync_error:
          counters.failed > 0
            ? `${counters.failed} reconciliation item(s) failed and need review.`
            : null,
        import_cursor: {
          ...importCursor,
          reconcile_last_offset: offset,
          reconcile_next_offset: nextOffset,
          reconcile_stage_last_offset: stagedOffset,
          reconcile_stage_next_offset: nextStagedOffset,
          reconcile_has_more: hasMore,
          reconcile_complete: !hasMore,
          reconcile_total_linked: linkedCount,
          reconcile_total_staged: stagedCount,
          reconcile_completed_at: completedAt,
        },
        provider_metadata: {
          ...recordValue(connectionState.provider_metadata),
          latest_reconciliation: {
            run_id: runId,
            ...summary,
            scanned_count: scannedCount,
            matched_count: counters.matched,
            quantity_reduced_count: counters.quantityReduced,
            sold_count: counters.sold,
            review_count: counters.review,
            failed_count: counters.failed,
            completed_at: completedAt,
          },
        },
        updated_at: completedAt,
      })
      .eq("id", auth.connectionId)
      .eq("account_id", params.accountId)
      .eq("store_id", params.storeId);

    return {
      runId,
      status,
      offset,
      nextOffset,
      hasMore,
      totalLinked: linkedCount,
      scannedCount,
      matchedCount: counters.matched,
      quantityReducedCount: counters.quantityReduced,
      soldCount: counters.sold,
      reviewCount: counters.review,
      failedCount: counters.failed,
    };
  } catch (error: any) {
    const failedAt = new Date().toISOString();
    await params.supabase
      .from("seller_marketplace_reconciliation_runs")
      .update({
        status: "failed",
        failed_count: 1,
        summary: {
          error: String(error.message || "Reconciliation failed").slice(0, 500),
        },
        completed_at: failedAt,
        updated_at: failedAt,
      })
      .eq("id", runId);
    await params.supabase
      .from("seller_marketplace_connections")
      .update({
        sync_status: "failed",
        last_sync_completed_at: failedAt,
        last_sync_error: String(
          error.message || "Seller eBay reconciliation failed",
        ).slice(0, 500),
        updated_at: failedAt,
      })
      .eq("id", auth.connectionId)
      .eq("account_id", params.accountId)
      .eq("store_id", params.storeId);
    throw error;
  }
}
