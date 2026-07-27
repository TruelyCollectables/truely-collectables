import type { SupabaseClient } from "@supabase/supabase-js";
import { InventoryEngineError } from "../modules/inventory";

export const CHECKOUT_RESERVATION_MINUTES = 32;

type ReservationRow = {
  reservation_id: string;
  legacy_product_id: number;
  inventory_item_id: string;
  reserved_quantity: number;
  expires_at: string;
};

type InventoryConsumptionRow = {
  inventory_item_id: string;
  previous_quantity: number;
  new_quantity: number;
  already_consumed: boolean;
};

function reservationError(error: unknown): InventoryEngineError | Error {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : String(error || "Checkout inventory reservation failed");

  if (message.includes("insufficient_inventory")) {
    return new InventoryEngineError(
      "One or more cards were just reserved or sold. Review the paid order before fulfillment.",
      409,
    );
  }

  if (message.includes("inventory_not_active")) {
    return new InventoryEngineError(
      "One or more cards are no longer available for checkout.",
      409,
    );
  }

  if (
    message.includes("inventory_product_not_found") ||
    message.includes("inventory_legacy_product_not_found")
  ) {
    return new InventoryEngineError(
      "One or more cards could not be found in live inventory.",
      404,
    );
  }

  if (message.includes("reservation_consume_not_found")) {
    return new InventoryEngineError(
      "The paid checkout no longer has a matching inventory reservation.",
      409,
    );
  }

  if (
    message.includes("reservation_consume_session_mismatch") ||
    message.includes("reservation_consume_quantity_mismatch") ||
    message.includes("reservation_consume_not_active") ||
    message.includes("order_inventory_quantity_mismatch")
  ) {
    return new InventoryEngineError(
      "The paid checkout inventory could not be safely reconciled.",
      409,
    );
  }

  if (
    message.includes("reservation_cart_") ||
    message.includes("reservation_consume_quantity_invalid") ||
    message.includes("reservation_consume_session_missing") ||
    message.includes("order_inventory_quantity_invalid")
  ) {
    return new InventoryEngineError("The cart could not be reconciled.", 400);
  }

  return error instanceof Error ? error : new Error(message);
}

function normalizeConsumptionRow(data: unknown) {
  const row = (Array.isArray(data) ? data[0] : data) as
    | InventoryConsumptionRow
    | null;

  if (!row) {
    throw new Error("Inventory consumption returned no result.");
  }

  return {
    inventoryItemId: row.inventory_item_id,
    previousQuantity: Number(row.previous_quantity || 0),
    newQuantity: Number(row.new_quantity || 0),
    alreadyConsumed: row.already_consumed === true,
  };
}

export async function reserveCheckoutInventory(params: {
  supabase: SupabaseClient;
  storeId: string;
  checkoutAttemptId: string;
  cart: Array<{ id: number; quantity: number }>;
  ttlMinutes?: number;
}) {
  const { data, error } = await params.supabase.rpc(
    "tcos_reserve_checkout_inventory",
    {
      p_store_id: params.storeId,
      p_checkout_attempt_id: params.checkoutAttemptId,
      p_items: params.cart,
      p_ttl_minutes: params.ttlMinutes ?? CHECKOUT_RESERVATION_MINUTES,
    },
  );

  if (error) throw reservationError(error);

  const rows = (Array.isArray(data) ? data : []) as ReservationRow[];
  if (rows.length !== params.cart.length) {
    throw new Error("Checkout reservation did not cover every cart line.");
  }

  const expectedByProduct = new Map(
    params.cart.map((item) => [Number(item.id), Number(item.quantity)]),
  );
  const returnedProducts = new Set<number>();
  for (const row of rows) {
    const productId = Number(row.legacy_product_id);
    const expectedQuantity = expectedByProduct.get(productId);
    if (
      !expectedQuantity ||
      returnedProducts.has(productId) ||
      Number(row.reserved_quantity) !== expectedQuantity ||
      !row.reservation_id ||
      !row.inventory_item_id
    ) {
      throw new Error("Checkout reservation returned an invalid cart line.");
    }
    returnedProducts.add(productId);
  }
  if (returnedProducts.size !== expectedByProduct.size) {
    throw new Error("Checkout reservation returned the wrong products.");
  }

  const expiresAt = rows
    .map((row) => new Date(row.expires_at).getTime())
    .filter(Number.isFinite)
    .sort((left, right) => left - right)[0];

  if (!Number.isFinite(expiresAt)) {
    throw new Error("Checkout reservation returned no valid expiration time.");
  }

  return {
    rows,
    expiresAt: new Date(expiresAt).toISOString(),
    expiresAtUnix: Math.floor(expiresAt / 1000),
  };
}

export async function attachStripeSessionToCheckoutReservation(params: {
  supabase: SupabaseClient;
  storeId: string;
  checkoutAttemptId: string;
  stripeSessionId: string;
  expectedCount?: number;
}) {
  const { data, error } = await params.supabase
    .from("checkout_inventory_reservations")
    .update({
      stripe_session_id: params.stripeSessionId,
      updated_at: new Date().toISOString(),
    })
    .eq("store_id", params.storeId)
    .eq("checkout_attempt_id", params.checkoutAttemptId)
    .eq("status", "active")
    .select("id");

  if (error) throw error;
  const expectedCount = Math.max(1, Math.floor(params.expectedCount || 1));
  if (!data || data.length !== expectedCount) {
    throw new Error(
      `Stripe Session attachment covered ${data?.length || 0}/${expectedCount} inventory reservations.`,
    );
  }
}

export async function consumeCheckoutReservationAfterSale(params: {
  supabase: SupabaseClient;
  storeId: string;
  checkoutAttemptId: string;
  legacyProductId: number;
  quantity: number;
  stripeSessionId: string;
}) {
  const { data, error } = await params.supabase.rpc(
    "tcos_consume_checkout_reservation_after_sale",
    {
      p_store_id: params.storeId,
      p_checkout_attempt_id: params.checkoutAttemptId,
      p_legacy_product_id: params.legacyProductId,
      p_quantity: params.quantity,
      p_stripe_session_id: params.stripeSessionId,
    },
  );

  if (error) throw reservationError(error);
  return normalizeConsumptionRow(data);
}

export async function decrementOrderInventoryOnce(params: {
  supabase: SupabaseClient;
  storeId: string;
  orderId: number;
  legacyProductId: number;
  quantity: number;
}) {
  const { data, error } = await params.supabase.rpc(
    "tcos_decrement_order_inventory_once",
    {
      p_store_id: params.storeId,
      p_order_id: params.orderId,
      p_legacy_product_id: params.legacyProductId,
      p_quantity: params.quantity,
    },
  );

  if (error) throw reservationError(error);
  return normalizeConsumptionRow(data);
}

export async function releaseCheckoutReservation(params: {
  supabase: SupabaseClient;
  storeId: string;
  checkoutAttemptId: string;
}) {
  const now = new Date().toISOString();
  const { error } = await params.supabase
    .from("checkout_inventory_reservations")
    .update({
      status: "released",
      released_at: now,
      updated_at: now,
    })
    .eq("store_id", params.storeId)
    .eq("checkout_attempt_id", params.checkoutAttemptId)
    .eq("status", "active");

  if (error) throw error;
}

export async function releaseCheckoutReservationForExpiredSession(params: {
  supabase: SupabaseClient;
  storeId: string;
  stripeSessionId: string;
}) {
  const now = new Date().toISOString();
  const { data, error } = await params.supabase
    .from("checkout_inventory_reservations")
    .update({
      status: "released",
      released_at: now,
      updated_at: now,
    })
    .eq("store_id", params.storeId)
    .eq("stripe_session_id", params.stripeSessionId)
    .eq("status", "active")
    .select("id");

  if (error) throw error;
  return { releasedCount: data?.length || 0 };
}
