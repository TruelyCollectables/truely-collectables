import fs from "node:fs";
import { execFileSync } from "node:child_process";

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  fs.mkdirSync(path.split("/").slice(0, -1).join("/"), { recursive: true });
  fs.writeFileSync(path, content.endsWith("\n") ? content : `${content}\n`);
}

function fromAuditPr(path) {
  return run("git", ["show", `origin/pr142:${path}`]);
}

for (const path of [
  "src/lib/ebay-quantity-sync-safety.ts",
  "src/lib/ebay-quantity-sync-outbox.ts",
  "supabase/migrations/20260726233000_post_sale_ebay_quantity_sync_outbox.sql",
  "supabase/migrations/20260727142000_harden_post_sale_outbox_constraints.sql",
  "supabase/migrations/20260727143000_order_notification_retry_backoff.sql",
]) {
  write(path, fromAuditPr(path));
}

const cronPath = "src/app/api/cron/ebay-store-fixed-price-sync/route.ts";
let cron = read(cronPath);
cron = cron.replace(
  'import { syncRecentLegacyEbayQuantities } from "../../../../lib/ebay-fixed-price-backfill";\n',
  'import { syncRecentLegacyEbayQuantities } from "../../../../lib/ebay-fixed-price-backfill";\nimport { retryPendingEbayQuantitySyncs } from "../../../../lib/ebay-quantity-sync-outbox";\nimport { retryOrderNotifications } from "../../../../lib/order-notifications";\n',
);
cron = cron.replace(
  '  const errors: SyncError[] = [];\n',
  '  const errors: SyncError[] = [];\n  const warnings: SyncError[] = [];\n',
);
cron = cron.replace(
  '  let activeLinkedProducts: number | null = null;\n\n  try {\n    firstAuthoritative',
  `  let activeLinkedProducts: number | null = null;
  let postSaleProtectionAvailable = true;
  let postSaleQuantitySync: Awaited<
    ReturnType<typeof retryPendingEbayQuantitySyncs>
  > | null = null;
  let notificationRetry: Awaited<
    ReturnType<typeof retryOrderNotifications>
  > | null = null;

  try {
    postSaleQuantitySync = await retryPendingEbayQuantitySyncs({
      supabase,
      storeId,
      limit: 100,
    });
    if (postSaleQuantitySync.deferredProducts > 0) {
      warnings.push({
        step: "post_sale_ebay_quantity_retry",
        error: \\`${"${postSaleQuantitySync.deferredProducts}"} sold product${"${postSaleQuantitySync.deferredProducts === 1 ? \"\" : \"s\"}"} remain protected locally and queued for another outbound eBay quantity retry.\\`,
      });
    }
  } catch (error) {
    postSaleProtectionAvailable = false;
    errors.push({
      step: "post_sale_ebay_quantity_retry",
      error: safeErrorMessage(
        error,
        "Durable post-sale eBay quantity protection is unavailable",
      ),
    });
  }

  try {
    notificationRetry = await retryOrderNotifications({
      supabase,
      storeId,
      limit: 25,
    });
    if (notificationRetry.failed > 0) {
      warnings.push({
        step: "order_notification_retry",
        error: \\`${"${notificationRetry.failed}"} customer notification${"${notificationRetry.failed === 1 ? \"\" : \"s\"}"} remain queued after this retry pass.\\`,
      });
    }
  } catch (error) {
    warnings.push({
      step: "order_notification_retry",
      error: safeErrorMessage(error, "Order notification retry failed"),
    });
  }

  if (postSaleProtectionAvailable) {
    try {
      firstAuthoritative`,
);
const authoritativeCatch = `  } catch (error) {
    errors.push({
      step: "authoritative_full_store_sync",
      error: safeErrorMessage(error, "Full eBay store sync failed"),
    });
  }

  if (errors.length === 0) {`;
const replacementCatch = `    } catch (error) {
      errors.push({
        step: "authoritative_full_store_sync",
        error: safeErrorMessage(error, "Full eBay store sync failed"),
      });
    }
  } else {
    errors.push({
      step: "authoritative_full_store_sync",
      error:
        "Inbound eBay reconciliation was skipped because durable post-sale quantity protection could not be verified.",
    });
  }

  if (errors.length === 0) {`;
if (!cron.includes(authoritativeCatch)) {
  throw new Error("Could not locate authoritative eBay catch block.");
}
cron = cron.replace(authoritativeCatch, replacementCatch);
cron = cron.replace(
  '    schema: "truelycollectables.ebayStoreFixedPriceSyncReceipt.v2",',
  '    schema: "truelycollectables.ebayStoreFixedPriceSyncReceipt.v3",',
);
cron = cron.replace(
  '    durationMs,\n    authoritative:',
  '    durationMs,\n    postSaleProtectionAvailable,\n    postSaleQuantitySync,\n    notificationRetry,\n    warnings,\n    authoritative:',
);
write(cronPath, cron);

const notificationsPath = "src/lib/order-notifications.ts";
let notifications = read(notificationsPath);
notifications = notifications.replace(
  '  const limit = Math.min(Math.max(Math.floor(params.limit || 25), 1), 100);\n  const { data, error } = await params.supabase',
  '  const limit = Math.min(Math.max(Math.floor(params.limit || 25), 1), 100);\n  const now = new Date().toISOString();\n  const { data, error } = await params.supabase',
);
notifications = notifications.replace(
  '    .lt("attempt_count", 10)\n    .order("created_at", { ascending: true })',
  '    .lt("attempt_count", 10)\n    .lte("next_attempt_at", now)\n    .order("next_attempt_at", { ascending: true })\n    .order("created_at", { ascending: true })',
);
write(notificationsPath, notifications);

const simulation = `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ebayQuantityRetryDelaySeconds,
  selectLowestSafeEbayQuantity,
} from "../src/lib/ebay-quantity-sync-safety";

assert.equal(selectLowestSafeEbayQuantity([0, 1, 1]), 0);
assert.equal(selectLowestSafeEbayQuantity([1, 0, 1]), 0);
assert.equal(selectLowestSafeEbayQuantity([2, 1, 3]), 1);
assert.equal(selectLowestSafeEbayQuantity(["2", null, undefined, -1, "bad"]), 2);
assert.throws(() => selectLowestSafeEbayQuantity([null, undefined, -1, "bad"]), /No safe local quantity/);
assert.equal(ebayQuantityRetryDelaySeconds(0), 900);
assert.equal(ebayQuantityRetryDelaySeconds(1), 1800);
assert.equal(ebayQuantityRetryDelaySeconds(5), 21600);

const migration = readFileSync("supabase/migrations/20260726233000_post_sale_ebay_quantity_sync_outbox.sql", "utf8");
const hardening = readFileSync("supabase/migrations/20260727142000_harden_post_sale_outbox_constraints.sql", "utf8");
const notificationBackoff = readFileSync("supabase/migrations/20260727143000_order_notification_retry_backoff.sql", "utf8");
const cron = readFileSync("src/app/api/cron/ebay-store-fixed-price-sync/route.ts", "utf8");
const notifications = readFileSync("src/lib/order-notifications.ts", "utf8");
const checkoutFinalization = readFileSync("src/lib/checkout-order-finalization.ts", "utf8");

for (const required of [
  "create table if not exists public.ebay_quantity_sync_outbox",
  "after update of status on public.checkout_inventory_reservations",
  "after insert on public.order_inventory_consumptions",
  "before update of quantity on public.products",
  "before update of quantity, status on public.inventory_items",
  "and outbox.status = 'pending'",
  "grant select, insert, update, delete on public.ebay_quantity_sync_outbox to service_role",
]) assert.ok(migration.includes(required), required);
assert.ok(hardening.includes("on delete set null"));
assert.ok(notificationBackoff.includes("next_attempt_at"));

const outbound = cron.indexOf("retryPendingEbayQuantitySyncs({");
const inbound = cron.indexOf("runEbayAuthoritativeStoreSync({");
assert.ok(outbound >= 0 && inbound >= 0 && outbound < inbound);
assert.ok(cron.includes("if (postSaleProtectionAvailable)"));
assert.ok(cron.includes("retryOrderNotifications({"));
assert.ok(cron.includes("Inbound eBay reconciliation was skipped"));
assert.ok(notifications.includes('.lte("next_attempt_at", now)'));
assert.ok(checkoutFinalization.includes("syncEbayQuantityAfterSale({"));

console.log("Post-sale eBay quantity resurrection protection and scheduled notification retry regressions passed.");
`;
write("scripts/run-post-sale-ebay-sync-simulations.ts", simulation);

const packagePath = "package.json";
const packageJson = JSON.parse(read(packagePath));
packageJson.scripts["simulate:post-sale-ebay-sync"] =
  "node --import tsx scripts/run-post-sale-ebay-sync-simulations.ts";
write(packagePath, JSON.stringify(packageJson, null, 2));

console.log("Applied durable post-sale eBay quantity and notification retry safety changes.");
