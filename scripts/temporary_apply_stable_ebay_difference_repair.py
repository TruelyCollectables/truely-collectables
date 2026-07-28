from pathlib import Path
import re

sync_path = Path("src/lib/ebay-authoritative-store-sync.ts")
source = sync_path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    source = source.replace(old, new, 1)


replace_once(
    'import { getStoreSettings } from "./store-settings";\n'
    'import { listingImageIdentity } from "./listing-image-utils";\n'
    'import { InventoryRepository } from "../modules/inventory";',
    'import { getStoreSettings } from "./store-settings";\n'
    'import { InventoryRepository } from "../modules/inventory";',
    "remove image comparison import",
)

replace_once(
    '''function normalizedNullableText(value: unknown) {
  return String(value || "").trim();
}

function listingChanged(
  local: LocalProduct,
  remote: EbayStoreRemoteListing,
) {
  return (
    local.title !== remote.title ||
    Number(local.quantity) !== remote.quantity ||
    Math.round(Number(local.price) * 100) !==
      Math.round(remote.price * 100) ||
    listingImageIdentity(local.image_url) !==
      listingImageIdentity(remote.imageUrl) ||
    normalizedNullableText(local.sport) !==
      normalizedNullableText(remote.sport) ||
    (!local.sku && Boolean(remote.sku))
  );
}''',
    '''function normalizedComparableText(value: unknown) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\\s+/g, " ")
    .trim();
}

function listingDifferences(
  local: LocalProduct,
  remote: EbayStoreRemoteListing,
) {
  const differences: string[] = [];
  if (
    normalizedComparableText(local.title) !==
    normalizedComparableText(remote.title)
  ) {
    differences.push("title");
  }
  if (Number(local.quantity) !== remote.quantity) {
    differences.push("quantity");
  }
  if (
    Math.round(Number(local.price) * 100) !==
    Math.round(remote.price * 100)
  ) {
    differences.push("price");
  }
  if (
    normalizedComparableText(local.sport) !==
    normalizedComparableText(remote.sport)
  ) {
    differences.push("sport");
  }
  if (!normalizedComparableText(local.sku) && remote.sku) {
    differences.push("missing_sku");
  }
  return differences;
}

function listingChanged(
  local: LocalProduct,
  remote: EbayStoreRemoteListing,
) {
  // The complete image synchronizer owns image convergence. Keeping image
  // URLs out of this comparison prevents the two stages from fighting over
  // equivalent or intentionally preserved images.
  return listingDifferences(local, remote).length > 0;
}''',
    "stable field comparison",
)

replace_once(
    '''    (listing) => {
      const local = localByItemId.get(listing.itemId) || null;
      const action = !local
        ? "insert"
        : taxonomyRefreshRequired || listingChanged(local, listing)
          ? "update"
          : "unchanged";
      return {''',
    '''    (listing) => {
      const local = localByItemId.get(listing.itemId) || null;
      const differences = local ? listingDifferences(local, listing) : [];
      const action = !local
        ? "insert"
        : taxonomyRefreshRequired || differences.length > 0
          ? "update"
          : "unchanged";
      return {''',
    "action differences",
)

old_reason = '"Local title, quantity, price, image identity, sport, or SKU differs from eBay."'
if source.count(old_reason) != 1:
    raise SystemExit(
        f"field-level reason: expected one match, found {source.count(old_reason)}"
    )
source = source.replace(
    old_reason,
    '`Local differences: ${differences.join(", ")}.`',
    1,
)
sync_path.write_text(source)

route_path = Path("src/app/api/cron/ebay-store-fixed-price-sync/route.ts")
route = route_path.read_text()
pattern = r'''errorSample: sync\.errors\.slice\(0, 5\)\.map\(\(entry\) => \(\{\s*itemId: entry\.itemId,\s*error: safeErrorMessage\(entry\.error, "Unknown listing sync error"\),\s*\}\)\),'''
replacement = '''errorSample: sync.errors.slice(0, 5).map((entry) => ({
          itemId: entry.itemId,
          error: safeErrorMessage(entry.error, "Unknown listing sync error"),
        })),
        changedSample: sync.actions
          .filter((entry) =>
            ["insert", "update", "deactivate", "error"].includes(entry.action),
          )
          .slice(0, 10)
          .map((entry) => ({
            itemId: entry.itemId,
            title: entry.title.slice(0, 120),
            action: entry.action,
            reason: safeErrorMessage(entry.reason, "Listing changed"),
            remoteQuantity: entry.remoteQuantity,
            localQuantity: entry.localQuantity,
            remotePrice: entry.remotePrice,
            localPrice: entry.localPrice,
            sku: entry.sku,
            categoryName: entry.categoryName,
          })),'''
route, count = re.subn(pattern, lambda _: replacement, route, count=1, flags=re.S)
if count != 1:
    raise SystemExit(f"changed receipt sample: expected one match, found {count}")
route_path.write_text(route)

# Add temporary assertions for certification. Only the production files are
# packaged for the final API commit.
taxonomy_test = Path("scripts/run-storefront-taxonomy-regressions.ts")
test = taxonomy_test.read_text()
marker = 'assert.ok(\n  authoritativeSyncSource.includes("const MAX_ACTIVE_LISTINGS = 3000;"),'
addition = '''assert.match(
  authoritativeSyncSource,
  /function normalizedComparableText[\\s\\S]*\\.normalize\\("NFKC"\\)/,
  "Equivalent Unicode title text must compare consistently.",
);
assert.match(
  authoritativeSyncSource,
  /function listingDifferences[\\s\\S]*differences\\.push\\("title"\\)[\\s\\S]*differences\\.push\\("quantity"\\)[\\s\\S]*differences\\.push\\("price"\\)[\\s\\S]*differences\\.push\\("sport"\\)/,
  "Field-level convergence diagnostics must remain deterministic.",
);
assert.ok(
  !authoritativeSyncSource.includes("listingImageIdentity(local.image_url)"),
  "Authoritative inventory and complete image reconciliation must not fight.",
);
''' + marker
if test.count(marker) != 1:
    raise SystemExit("taxonomy certification marker was not unique")
taxonomy_test.write_text(test.replace(marker, addition, 1))

image_test = Path("scripts/run-ebay-import-admin-client-simulations.ts")
test = image_test.read_text()
marker = '''assert.match(
  scheduledEbaySync,
  /syncEbayAllListingImages/,
  "The scheduled authoritative eBay job must run complete 1–20 image reconciliation.",
);'''
addition = '''assert.match(
  scheduledEbaySync,
  /changedSample: sync\\.actions[\\s\\S]*entry\\.itemId[\\s\\S]*entry\\.reason/,
  "Production receipts must expose a bounded changed-listing sample.",
);
''' + marker
if test.count(marker) != 1:
    raise SystemExit("receipt certification marker was not unique")
image_test.write_text(test.replace(marker, addition, 1))
