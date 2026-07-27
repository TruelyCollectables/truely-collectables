import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath =
  "supabase/migrations/20260727144000_preserve_reserved_product_identity.sql";
const migration = fs.readFileSync(migrationPath, "utf8");

for (const contract of [
  "checkout_inventory_reservations_inventory_item_id_fkey",
  "references public.inventory_items(id)",
  "on delete restrict",
  "checkout_inventory_reservations_product_store_fkey",
  "foreign key (legacy_product_id, store_id)",
  "references public.products(id, store_id)",
  "validate constraint checkout_inventory_reservations_product_store_fkey",
]) {
  assert.ok(migration.includes(contract), `${migrationPath} is missing ${contract}.`);
}

assert.doesNotMatch(
  migration,
  /checkout_inventory_reservations_inventory_item_id_fkey[\s\S]*on delete cascade/i,
  "A payable reservation must never disappear because its inventory row was deleted.",
);

const orderedMigrations = [
  "20260726233000_post_sale_ebay_quantity_sync_outbox.sql",
  "20260726234000_consume_attached_offer_checkout_reservations.sql",
  "20260727141000_hold_attached_checkout_reservations.sql",
  "20260727142000_harden_post_sale_outbox_constraints.sql",
  "20260727143000_order_notification_retry_backoff.sql",
  "20260727144000_preserve_reserved_product_identity.sql",
];

const available = fs
  .readdirSync("supabase/migrations")
  .filter((name) => orderedMigrations.includes(name))
  .sort();
assert.deepEqual(
  available,
  orderedMigrations,
  "Emergency storefront migrations must remain complete and ordered before application deployment.",
);

console.log(
  "Reserved product identity and emergency migration-order simulations passed.",
);
