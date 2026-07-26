import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationsDirectory = path.join(root, "supabase", "migrations");

const requirements = [
  {
    category: "inventory",
    name: "inventory_items_store_legacy_product_unique_idx",
    description: "one canonical inventory row per store/product",
  },
  {
    category: "inventory",
    name: "inventory_shadow_merge_archive",
    description: "recoverable archive for duplicate inventory cleanup",
  },
  {
    category: "checkout",
    name: "checkout_inventory_reservations_state_timestamps_check",
    description: "reservation state timestamp integrity",
  },
  {
    category: "checkout",
    name: "checkout_inventory_reservations_release_timestamp_check",
    description: "reservation release timestamp integrity",
  },
  {
    category: "checkout",
    name: "tcos_claim_checkout_attempt",
    description: "idempotent checkout-attempt claim",
  },
  {
    category: "checkout",
    name: "tcos_claim_stripe_webhook_event",
    description: "Stripe webhook event claim and deduplication",
  },
  {
    category: "checkout",
    name: "tcos_cleanup_checkout_e2e",
    description: "safe isolated checkout test cleanup",
  },
  {
    category: "checkout",
    name: "tcos_consume_checkout_reservation_after_sale",
    description: "reservation-backed inventory consumption",
  },
  {
    category: "checkout",
    name: "tcos_decrement_order_inventory_once",
    description: "order-idempotent inventory decrement",
  },
  {
    category: "checkout",
    name: "tcos_reserve_checkout_inventory",
    description: "atomic checkout inventory reservation",
  },
  {
    category: "orders",
    name: "orders_store_stripe_session_unique_idx",
    description: "one order per store and Stripe Checkout Session",
  },
  {
    category: "orders",
    name: "order_items_store_order_product_unique_idx",
    description: "one order-item row per store/order/product",
  },
  {
    category: "orders",
    name: "order_items_quantity_positive_check",
    description: "positive order-item quantity",
  },
  {
    category: "orders",
    name: "order_items_price_nonnegative_check",
    description: "nonnegative order-item price",
  },
  {
    category: "orders",
    name: "orders_item_count_nonnegative_check",
    description: "nonnegative order item count",
  },
  {
    category: "orders",
    name: "orders_subtotal_nonnegative_check",
    description: "nonnegative order subtotal",
  },
  {
    category: "orders",
    name: "orders_shipping_amount_nonnegative_check",
    description: "nonnegative shipping amount",
  },
  {
    category: "orders",
    name: "orders_total_nonnegative_check",
    description: "nonnegative order total",
  },
  {
    category: "orders",
    name: "order_items_order_store_fkey",
    description: "store-scoped order-item to order foreign key",
  },
  {
    category: "orders",
    name: "order_items_product_store_fkey",
    description: "store-scoped order-item to product foreign key",
  },
  {
    category: "orders",
    name: "order_inventory_consumptions_order_store_fkey",
    description: "store-scoped consumption to order foreign key",
  },
  {
    category: "orders",
    name: "order_inventory_consumptions_inventory_store_fkey",
    description: "store-scoped consumption to inventory foreign key",
  },
  {
    category: "orders",
    name: "order_inventory_consumptions_product_store_fkey",
    description: "store-scoped consumption to product foreign key",
  },
  {
    category: "payouts",
    name: "seller_payout_accounts_internal_owner_contract_check",
    description: "complete non-Connect contract for the platform store owner",
  },
];

if (!fs.existsSync(migrationsDirectory)) {
  throw new Error("supabase/migrations is missing.");
}

const migrationFiles = fs
  .readdirSync(migrationsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
  .map((entry) => entry.name)
  .sort();

if (migrationFiles.length === 0) {
  throw new Error("No Supabase migration files were found.");
}

const migrations = migrationFiles.map((fileName) => {
  const content = fs.readFileSync(path.join(migrationsDirectory, fileName), "utf8");
  return {
    fileName,
    content,
    normalized: content.toLowerCase(),
  };
});

const results = requirements.map((requirement) => {
  const token = requirement.name.toLowerCase();
  const files = migrations
    .filter((migration) => migration.normalized.includes(token))
    .map((migration) => migration.fileName);

  return {
    ...requirement,
    files,
    covered: files.length > 0,
  };
});

for (const result of results) {
  console.log(
    `${result.covered ? "PASS" : "MISSING"} [${result.category}] ${result.name}` +
      ` :: ${result.description}` +
      (result.covered ? ` :: ${result.files.join(", ")}` : ""),
  );
}

const missing = results.filter((result) => !result.covered);

if (missing.length > 0) {
  throw new Error(
    `Launch database migration coverage is missing ${missing.length} required object(s):\n${missing
      .map((result) => `- [${result.category}] ${result.name}: ${result.description}`)
      .join("\n")}`,
  );
}

console.log(
  `Launch database migration coverage passed: ${results.length}/${results.length} required objects found across ${migrationFiles.length} migration files.`,
);
