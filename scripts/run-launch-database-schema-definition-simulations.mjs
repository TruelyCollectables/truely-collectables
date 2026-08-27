import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260726023000_reproduce_launch_inventory_order_integrity.sql",
);

assert.ok(fs.existsSync(migrationPath), "Launch inventory/order integrity migration is missing.");

const sql = fs.readFileSync(migrationPath, "utf8");
const normalized = sql.toLowerCase().replace(/\s+/g, " ").trim();

const contracts = [
  [
    "inventory composite parent key",
    /create unique index if not exists inventory_items_id_store_id_unique_idx on public\.inventory_items \(id, store_id\)/,
  ],
  [
    "orders composite parent key",
    /create unique index if not exists orders_id_store_id_unique_idx on public\.orders \(id, store_id\)/,
  ],
  [
    "products composite parent key",
    /create unique index if not exists products_id_store_id_unique_idx on public\.products \(id, store_id\)/,
  ],
  [
    "canonical inventory product uniqueness",
    /create unique index if not exists inventory_items_store_legacy_product_unique_idx on public\.inventory_items \(store_id, legacy_product_id\) where legacy_product_id is not null/,
  ],
  [
    "canonical Stripe session uniqueness",
    /create unique index if not exists orders_store_stripe_session_uidx on public\.orders \(store_id, stripe_session_id\) where stripe_session_id is not null and btrim\(stripe_session_id\) <> ''/,
  ],
  [
    "redundant Stripe session index cleanup",
    /drop index if exists public\.orders_store_stripe_session_unique_idx/,
  ],
  [
    "order item identity uniqueness",
    /create unique index if not exists order_items_store_order_product_unique_idx on public\.order_items \(store_id, order_id, product_id\)/,
  ],
  [
    "consumed reservation timestamp contract",
    /constraint checkout_inventory_reservations_state_timestamps_check check \( \( status = 'consumed' and consumed_at is not null and stripe_session_id is not null \) or \( status <> 'consumed' and consumed_at is null \) \) not valid/,
  ],
  [
    "released reservation timestamp contract",
    /constraint checkout_inventory_reservations_release_timestamp_check check \( \( status = 'released' and released_at is not null \) or \( status <> 'released' and released_at is null \) \) not valid/,
  ],
  ["positive order item quantity", /constraint order_items_quantity_positive_check check \(quantity > 0\) not valid/],
  ["nonnegative order item price", /constraint order_items_price_nonnegative_check check \(price >= 0::numeric\) not valid/],
  ["nonnegative order item count", /constraint orders_item_count_nonnegative_check check \(item_count >= 0\) not valid/],
  ["nonnegative order subtotal", /constraint orders_subtotal_nonnegative_check check \(subtotal >= 0::numeric\) not valid/],
  [
    "nonnegative shipping amount",
    /constraint orders_shipping_amount_nonnegative_check check \(shipping_amount >= 0::numeric\) not valid/,
  ],
  ["nonnegative order total", /constraint orders_total_nonnegative_check check \(total >= 0::numeric\) not valid/],
  [
    "order item to order store scope",
    /constraint order_items_order_store_fkey foreign key \(order_id, store_id\) references public\.orders \(id, store_id\) on delete cascade not valid/,
  ],
  [
    "order item to product store scope",
    /constraint order_items_product_store_fkey foreign key \(product_id, store_id\) references public\.products \(id, store_id\) not valid/,
  ],
  [
    "consumption to order store scope",
    /constraint order_inventory_consumptions_order_store_fkey foreign key \(order_id, store_id\) references public\.orders \(id, store_id\) on delete cascade not valid/,
  ],
  [
    "consumption to inventory store scope",
    /constraint order_inventory_consumptions_inventory_store_fkey foreign key \(inventory_item_id, store_id\) references public\.inventory_items \(id, store_id\) on delete restrict not valid/,
  ],
  [
    "consumption to product store scope",
    /constraint order_inventory_consumptions_product_store_fkey foreign key \(legacy_product_id, store_id\) references public\.products \(id, store_id\) on delete restrict not valid/,
  ],
];

for (const [label, pattern] of contracts) {
  assert.match(normalized, pattern, `Migration is missing or changed: ${label}.`);
}

for (const constraintName of [
  "checkout_inventory_reservations_state_timestamps_check",
  "checkout_inventory_reservations_release_timestamp_check",
  "order_items_quantity_positive_check",
  "order_items_price_nonnegative_check",
  "orders_item_count_nonnegative_check",
  "orders_subtotal_nonnegative_check",
  "orders_shipping_amount_nonnegative_check",
  "orders_total_nonnegative_check",
  "order_items_order_store_fkey",
  "order_items_product_store_fkey",
  "order_inventory_consumptions_order_store_fkey",
  "order_inventory_consumptions_inventory_store_fkey",
  "order_inventory_consumptions_product_store_fkey",
]) {
  assert.match(
    normalized,
    new RegExp(`validate constraint ${constraintName}`),
    `${constraintName} must be validated in the same migration.`,
  );
}

assert.match(normalized, /^begin;/, "Migration must begin transactionally.");
assert.match(normalized, /commit;$/, "Migration must commit transactionally.");
assert.doesNotMatch(normalized, /\bdelete\s+from\b/, "Migration must not delete business rows.");
assert.doesNotMatch(normalized, /\btruncate\b/, "Migration must not truncate business rows.");

console.log(
  `Launch database schema definition simulations passed: ${contracts.length + 17}/${contracts.length + 17}.`,
);
