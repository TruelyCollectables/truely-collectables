import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveCardIdentity, isLikelyPlayerName } from "./card-identity";

export const CARD_IDENTITY_BACKFILL_REVISION = "player-name-v4";

const PAGE_SIZE = 1000;
const SAMPLE_LIMIT = 25;
const WRITE_CONCURRENCY = 25;

type ProductRow = {
  id: number | string;
  store_id: string;
  title: string | null;
  player: string | null;
  sold_at: string | null;
  sold_price: number | null;
  sold_source: string | null;
  sold_reference: string | null;
  sold_price_status: string | null;
};

type InventoryRow = {
  id: string;
  store_id: string;
  legacy_product_id: number | string | null;
  metadata: Record<string, unknown> | null;
  sold_at: string | null;
  sold_price: number | null;
  sold_source: string | null;
  sold_reference: string | null;
  sold_price_status: string | null;
};

type RepairSample = {
  productId: number | string;
  title: string;
  previousPlayer: string | null;
  resolvedPlayer: string | null;
  action: "updated" | "cleared" | "unresolved";
};

type ProductPlayerUpdate = {
  id: number | string;
  player: string | null;
};

type InventoryMetadataUpdate = {
  id: string;
  metadata: Record<string, unknown>;
};

async function readAll<T>(
  queryFactory: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: { message?: string } | null;
  }>,
) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await queryFactory(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message || "Database read failed");
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

async function runConcurrentBatches<T>(params: {
  items: T[];
  worker: (item: T) => Promise<void>;
}) {
  for (let index = 0; index < params.items.length; index += WRITE_CONCURRENCY) {
    await Promise.all(
      params.items
        .slice(index, index + WRITE_CONCURRENCY)
        .map((item) => params.worker(item)),
    );
  }
}

function normalizePlayer(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function samePlayer(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base" }) === 0;
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sameSnapshot(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
) {
  return Object.entries(next).every(([key, value]) => previous[key] === value);
}

export async function backfillCardSaleIdentities(params: {
  supabase: SupabaseClient;
  storeId: string;
}) {
  const products = await readAll<ProductRow>((from, to) =>
    params.supabase
      .from("products")
      .select(
        "id,store_id,title,player,sold_at,sold_price,sold_source,sold_reference,sold_price_status",
      )
      .eq("store_id", params.storeId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const inventoryItems = await readAll<InventoryRow>((from, to) =>
    params.supabase
      .from("inventory_items")
      .select(
        "id,store_id,legacy_product_id,metadata,sold_at,sold_price,sold_source,sold_reference,sold_price_status",
      )
      .eq("store_id", params.storeId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const inventoryByProduct = new Map(
    inventoryItems
      .filter((row) => row.legacy_product_id !== null)
      .map((row) => [Number(row.legacy_product_id), row]),
  );

  let playersUpdated = 0;
  let playersCleared = 0;
  let playersVerified = 0;
  let invalidExistingPlayers = 0;
  let unresolved = 0;
  const repairSamples: RepairSample[] = [];
  const unresolvedSamples: RepairSample[] = [];
  const productUpdates: ProductPlayerUpdate[] = [];
  const inventoryUpdates: InventoryMetadataUpdate[] = [];

  for (const product of products) {
    const title = product.title || "Untitled";
    const currentPlayer = normalizePlayer(product.player);
    const currentIsValid = isLikelyPlayerName(currentPlayer);
    if (currentPlayer && !currentIsValid) invalidExistingPlayers += 1;

    const identity = deriveCardIdentity({
      title,
      aspectPlayer: currentPlayer,
    });
    const resolvedPlayer = normalizePlayer(identity.player);
    let finalPlayer = resolvedPlayer || null;

    if (resolvedPlayer) {
      if (!samePlayer(currentPlayer, resolvedPlayer)) {
        productUpdates.push({ id: product.id, player: resolvedPlayer });
        playersUpdated += 1;
        if (repairSamples.length < SAMPLE_LIMIT) {
          repairSamples.push({
            productId: product.id,
            title,
            previousPlayer: currentPlayer || null,
            resolvedPlayer,
            action: "updated",
          });
        }
      } else {
        playersVerified += 1;
      }
    } else {
      unresolved += 1;

      // Never leave a card brand, set, league, or parallel in Player / Subject.
      // If no real person can be resolved, clear the polluted value for review.
      if (currentPlayer && !currentIsValid) {
        productUpdates.push({ id: product.id, player: null });
        playersCleared += 1;
        finalPlayer = null;
        if (repairSamples.length < SAMPLE_LIMIT) {
          repairSamples.push({
            productId: product.id,
            title,
            previousPlayer: currentPlayer,
            resolvedPlayer: null,
            action: "cleared",
          });
        }
      }

      if (unresolvedSamples.length < SAMPLE_LIMIT) {
        unresolvedSamples.push({
          productId: product.id,
          title,
          previousPlayer: currentPlayer || null,
          resolvedPlayer: null,
          action: "unresolved",
        });
      }
    }

    const inventory = inventoryByProduct.get(Number(product.id));
    if (!inventory) continue;

    const previousMetadata = recordValue(inventory.metadata);
    const confidence =
      identity.confidence === "aspect"
        ? "cataloged"
        : identity.confidence === "title"
          ? "title_derived"
          : "unresolved";
    const cardIdentitySnapshot: Record<string, unknown> = {
      exact_title: identity.exactTitle,
      player: finalPlayer,
      card_number: identity.cardNumber,
      year: identity.year,
      confidence,
    };
    const saleIdentitySnapshot: Record<string, unknown> = {
      exact_title: identity.exactTitle,
      player: finalPlayer,
      card_number: identity.cardNumber,
      year: identity.year,
      sold_at: inventory.sold_at ?? product.sold_at ?? null,
      sold_price: inventory.sold_price ?? product.sold_price ?? null,
      sold_source: inventory.sold_source ?? product.sold_source ?? null,
      sold_reference: inventory.sold_reference ?? product.sold_reference ?? null,
      sold_price_status:
        inventory.sold_price_status ?? product.sold_price_status ?? null,
    };
    const previousCardIdentity = recordValue(previousMetadata.card_identity);
    const previousSaleIdentity = recordValue(previousMetadata.sale_identity);

    if (
      sameSnapshot(previousCardIdentity, cardIdentitySnapshot) &&
      sameSnapshot(previousSaleIdentity, saleIdentitySnapshot)
    ) {
      continue;
    }

    inventoryUpdates.push({
      id: inventory.id,
      metadata: {
        ...previousMetadata,
        card_identity: {
          ...cardIdentitySnapshot,
          enriched_at: new Date().toISOString(),
        },
        sale_identity: saleIdentitySnapshot,
      },
    });
  }

  await runConcurrentBatches({
    items: productUpdates,
    worker: async (update) => {
      const { error } = await params.supabase
        .from("products")
        .update({ player: update.player })
        .eq("id", update.id)
        .eq("store_id", params.storeId);
      if (error) throw new Error(error.message || "Player update failed");
    },
  });

  await runConcurrentBatches({
    items: inventoryUpdates,
    worker: async (update) => {
      const { error } = await params.supabase
        .from("inventory_items")
        .update({ metadata: update.metadata })
        .eq("id", update.id)
        .eq("store_id", params.storeId);
      if (error) throw new Error(error.message || "Identity metadata update failed");
    },
  });

  return {
    success: true,
    revision: CARD_IDENTITY_BACKFILL_REVISION,
    storeId: params.storeId,
    productsScanned: products.length,
    playersUpdated,
    playersCleared,
    playersVerified,
    invalidExistingPlayers,
    metadataUpdated: inventoryUpdates.length,
    unresolved,
    repairSamples,
    unresolvedSamples,
  };
}
