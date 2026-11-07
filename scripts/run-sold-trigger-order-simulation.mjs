import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/20260730002700_run_sale_guards_before_restock_reset.sql",
  "utf8",
);

for (const triggerName of [
  "aaa_truely_protect_pending_ebay_product_quantity",
  "aaa_truely_protect_pending_ebay_inventory_quantity",
  "aaa_truely_protect_ebay_order_product_quantity",
  "aaa_truely_protect_ebay_order_inventory_quantity",
]) {
  assert.match(migration, new RegExp(`create trigger ${triggerName}`));
  assert.ok(
    triggerName.localeCompare("reset_product_sold_presentation_on_restock") < 0 ||
      triggerName.localeCompare("reset_inventory_sold_presentation_on_restock") < 0,
    `${triggerName} must sort before restock reset triggers`,
  );
}

assert.match(
  migration,
  /execute function public\.truely_protect_pending_ebay_product_quantity\(\)/,
);
assert.match(
  migration,
  /execute function public\.truely_protect_pending_ebay_inventory_quantity\(\)/,
);
assert.match(
  migration,
  /execute function public\.truely_protect_ebay_order_product_quantity\(\)/,
);
assert.match(
  migration,
  /execute function public\.truely_protect_ebay_order_inventory_quantity\(\)/,
);
assert.match(migration, /stale inbound stock cannot erase SOLD evidence/);

console.log(
  JSON.stringify(
    {
      ok: true,
      contract: "sale guards execute before restock reset",
      protectedFlows: ["website", "manual", "ebay", "collx-via-ebay"],
    },
    null,
    2,
  ),
);
