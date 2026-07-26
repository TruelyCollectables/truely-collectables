import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationsDirectory = path.join(root, "supabase", "migrations");
const reportPath = path.join(root, "launch-database-migration-coverage.json");

const requirement = (category, name, description, tokens = [name]) => ({
  category,
  name,
  description,
  tokens,
});

const requirements = [
  requirement(
    "inventory",
    "canonical_inventory_product_uniqueness",
    "one canonical inventory row per store/product",
    ["inventory_items_store_legacy_product_unique_idx"],
  ),
  requirement(
    "inventory",
    "inventory_store_identity_parent_key",
    "composite inventory identity required by store-scoped foreign keys",
    ["inventory_items_id_store_id_unique_idx", "inventory_items_store_id_uidx"],
  ),
  requirement(
    "checkout",
    "checkout_inventory_reservations_state_timestamps_check",
    "reservation state timestamp integrity",
  ),
  requirement(
    "checkout",
    "checkout_inventory_reservations_release_timestamp_check",
    "reservation release timestamp integrity",
  ),
  requirement("checkout", "tcos_claim_checkout_attempt", "idempotent checkout-attempt claim"),
  requirement(
    "checkout",
    "tcos_claim_stripe_webhook_event",
    "Stripe webhook event claim and deduplication",
  ),
  requirement("checkout", "tcos_cleanup_checkout_e2e", "safe isolated checkout test cleanup"),
  requirement(
    "checkout",
    "tcos_consume_checkout_reservation_after_sale",
    "reservation-backed inventory consumption",
  ),
  requirement(
    "checkout",
    "tcos_decrement_order_inventory_once",
    "order-idempotent inventory decrement",
  ),
  requirement(
    "checkout",
    "tcos_reserve_checkout_inventory",
    "atomic checkout inventory reservation",
  ),
  requirement(
    "orders",
    "orders_store_stripe_session_uniqueness",
    "one order per store and Stripe Checkout Session",
    ["orders_store_stripe_session_uidx", "orders_store_stripe_session_unique_idx"],
  ),
  requirement(
    "orders",
    "order_items_store_order_product_unique_idx",
    "one order-item row per store/order/product",
  ),
  requirement(
    "orders",
    "orders_store_identity_parent_key",
    "composite order identity required by store-scoped foreign keys",
    ["orders_id_store_id_unique_idx", "orders_store_id_uidx"],
  ),
  requirement(
    "orders",
    "products_store_identity_parent_key",
    "composite product identity required by store-scoped foreign keys",
    ["products_id_store_id_unique_idx", "products_store_id_uidx"],
  ),
  requirement("orders", "order_items_quantity_positive_check", "positive order-item quantity"),
  requirement("orders", "order_items_price_nonnegative_check", "nonnegative order-item price"),
  requirement("orders", "orders_item_count_nonnegative_check", "nonnegative order item count"),
  requirement("orders", "orders_subtotal_nonnegative_check", "nonnegative order subtotal"),
  requirement(
    "orders",
    "orders_shipping_amount_nonnegative_check",
    "nonnegative shipping amount",
  ),
  requirement("orders", "orders_total_nonnegative_check", "nonnegative order total"),
  requirement(
    "orders",
    "order_items_order_store_fkey",
    "store-scoped order-item to order foreign key",
  ),
  requirement(
    "orders",
    "order_items_product_store_fkey",
    "store-scoped order-item to product foreign key",
  ),
  requirement(
    "orders",
    "order_inventory_consumptions_order_store_fkey",
    "store-scoped consumption to order foreign key",
  ),
  requirement(
    "orders",
    "order_inventory_consumptions_inventory_store_fkey",
    "store-scoped consumption to inventory foreign key",
  ),
  requirement(
    "orders",
    "order_inventory_consumptions_product_store_fkey",
    "store-scoped consumption to product foreign key",
  ),
  requirement(
    "payouts",
    "seller_payout_accounts_internal_owner_contract_check",
    "complete non-Connect contract for the platform store owner",
  ),
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
  return { fileName, normalized: content.toLowerCase() };
});

const results = requirements.map((item) => {
  const matches = [];

  for (const token of item.tokens) {
    const normalizedToken = token.toLowerCase();
    const files = migrations
      .filter((migration) => migration.normalized.includes(normalizedToken))
      .map((migration) => migration.fileName);

    if (files.length > 0) {
      matches.push({ token, files });
    }
  }

  return {
    ...item,
    covered: matches.length > 0,
    matches,
    files: Array.from(new Set(matches.flatMap((match) => match.files))).sort(),
  };
});

for (const result of results) {
  const matchedTokens = result.matches.map((match) => match.token).join(" | ");
  console.log(
    `${result.covered ? "PASS" : "MISSING"} [${result.category}] ${result.name}` +
      ` :: ${result.description}` +
      (result.covered
        ? ` :: ${matchedTokens} :: ${result.files.join(", ")}`
        : ` :: expected one of ${result.tokens.join(" | ")}`),
  );
}

const missing = results.filter((result) => !result.covered);
const report = {
  generatedAt: new Date().toISOString(),
  migrationFileCount: migrationFiles.length,
  requiredProtectionCount: results.length,
  coveredProtectionCount: results.length - missing.length,
  missingProtectionCount: missing.length,
  requirements: results,
};

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (missing.length > 0) {
  throw new Error(
    `Launch database migration coverage is missing ${missing.length} required protection(s):\n${missing
      .map(
        (result) =>
          `- [${result.category}] ${result.name}: ${result.description} (expected one of ${result.tokens.join(
            ", ",
          )})`,
      )
      .join("\n")}`,
  );
}

console.log(
  `Launch database migration coverage passed: ${results.length}/${results.length} required protections found across ${migrationFiles.length} migration files.`,
);
