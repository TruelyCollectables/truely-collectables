from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


merged_path = Path("src/lib/ebay-merged-listing-groups.ts")
merged_path.write_text(
    '''export const EBAY_MERGED_LISTING_GROUPS = [
  {
    key: "2025-donruss-400-jaxson-dart",
    canonicalLegacyProductId: 1991,
    aliasItemIds: ["317570836168", "317570836334"],
  },
] as const;

const mergedAliasItemIds = new Set<string>(
  EBAY_MERGED_LISTING_GROUPS.flatMap((group) => [...group.aliasItemIds]),
);

const mergedCanonicalProductIds = new Set<number>(
  EBAY_MERGED_LISTING_GROUPS.map((group) => group.canonicalLegacyProductId),
);

export function isMergedEbayAliasItemId(value: unknown) {
  return mergedAliasItemIds.has(String(value || "").trim());
}

export function isMergedEbayCanonicalProductId(value: unknown) {
  return mergedCanonicalProductIds.has(Number(value));
}

export function isMergedEbayListingMember(input: {
  itemId: unknown;
  legacyProductId: unknown;
}) {
  return (
    isMergedEbayAliasItemId(input.itemId) ||
    isMergedEbayCanonicalProductId(input.legacyProductId)
  );
}
'''
)

sync_path = Path("src/lib/ebay-authoritative-store-sync.ts")
source = sync_path.read_text()
source = replace_once(
    source,
    'import { getStoreSettings } from "./store-settings";\nimport { InventoryRepository } from "../modules/inventory";',
    'import { getStoreSettings } from "./store-settings";\nimport { EBAY_MERGED_LISTING_GROUPS } from "./ebay-merged-listing-groups";\nimport { InventoryRepository } from "../modules/inventory";',
    "merged group import",
)
source = replace_once(
    source,
    "  eligibleCollectibles: number;\n  skippedNonCollectibles: number;\n  eligibleSportsCards: number;",
    "  eligibleCollectibles: number;\n  skippedNonCollectibles: number;\n  mergedAliasListings: number;\n  representedInventoryRows: number;\n  eligibleSportsCards: number;",
    "result metrics",
)

insert_marker = "\nasync function safeSku(params: {"
insert_at = source.index(insert_marker)
helper = r'''
function collapseMergedRemoteListings(params: {
  remoteListings: EbayStoreRemoteListing[];
  locals: LocalProduct[];
}) {
  const localsById = new Map(params.locals.map((row) => [row.id, row] as const));
  const localByItemId = new Map(
    params.locals.map((row) => [String(row.ebay_item_id || ""), row] as const),
  );
  const claimedItemIds = new Set<string>();
  const mergedListings: EbayStoreRemoteListing[] = [];
  const aliasActions: EbayStoreSyncAction[] = [];
  let mergedAliasListings = 0;

  for (const group of EBAY_MERGED_LISTING_GROUPS) {
    const canonical = localsById.get(group.canonicalLegacyProductId) || null;
    const canonicalItemId = String(canonical?.ebay_item_id || "").trim();
    const aliasItemIds = new Set<string>(group.aliasItemIds);
    const activeAliases = params.remoteListings.filter((listing) =>
      aliasItemIds.has(listing.itemId),
    );

    if (!canonical || !canonicalItemId) {
      if (activeAliases.length > 0) {
        throw new Error(
          `Merged eBay canonical product ${group.canonicalLegacyProductId} is missing.`,
        );
      }
      continue;
    }

    const memberIds = new Set<string>([
      canonicalItemId,
      ...group.aliasItemIds,
    ]);
    const activeMembers = params.remoteListings.filter((listing) =>
      memberIds.has(listing.itemId),
    );
    if (activeMembers.length === 0) continue;

    for (const listing of activeMembers) claimedItemIds.add(listing.itemId);
    const representative =
      activeMembers.find((listing) => listing.itemId === canonicalItemId) ||
      activeMembers[0];
    const mergedQuantity = activeMembers.reduce(
      (total, listing) => total + listing.quantity,
      0,
    );

    mergedListings.push({
      ...representative,
      itemId: canonicalItemId,
      sku: canonical.sku || representative.sku,
      quantity: mergedQuantity,
    });
    mergedAliasListings += Math.max(activeMembers.length - 1, 0);

    for (const listing of activeMembers) {
      if (listing.itemId === canonicalItemId) continue;
      const aliasLocal = localByItemId.get(listing.itemId) || null;
      aliasActions.push({
        itemId: listing.itemId,
        title: listing.title,
        action: "skip",
        reason: `Merged alias represented by canonical legacy product ${canonical.id}.`,
        legacyProductId: aliasLocal?.id || null,
        remoteQuantity: listing.quantity,
        localQuantity: aliasLocal ? Number(aliasLocal.quantity) : null,
        remotePrice: listing.price,
        localPrice: aliasLocal ? Number(aliasLocal.price) : null,
        sku: aliasLocal?.sku || listing.sku,
        categoryName: listing.categoryName,
      });
    }
  }

  return {
    listings: [
      ...params.remoteListings.filter(
        (listing) => !claimedItemIds.has(listing.itemId),
      ),
      ...mergedListings,
    ],
    aliasActions,
    mergedAliasListings,
  };
}
'''
source = source[:insert_at] + helper + source[insert_at:]

start = source.index("  const localByItemId = new Map(", source.index("export async function runEbayAuthoritativeStoreSync"))
end = source.index("\n  if (remote.cycleComplete) {", start)
actions_block = r'''  const localByItemId = new Map(
    locals.map(
      (row) => [String(row.ebay_item_id || ""), row] as const,
    ),
  );
  const rawRemoteByItemId = new Map(
    remote.listings.map((row) => [row.itemId, row] as const),
  );
  const mergedRemote = collapseMergedRemoteListings({
    remoteListings: remote.listings,
    locals,
  });
  const effectiveRemoteListings = mergedRemote.listings;
  const effectiveRemoteByItemId = new Map(
    effectiveRemoteListings.map((row) => [row.itemId, row] as const),
  );
  const actions: EbayStoreSyncAction[] = [
    ...effectiveRemoteListings.map((listing) => {
      const local = localByItemId.get(listing.itemId) || null;
      const differences = local ? listingDifferences(local, listing) : [];
      const action = !local
        ? "insert"
        : taxonomyRefreshRequired || differences.length > 0
          ? "update"
          : "unchanged";
      return {
        itemId: listing.itemId,
        title: listing.title,
        action,
        reason:
          action === "insert"
            ? "Active eBay sports-card listing is missing locally."
            : action === "update"
              ? taxonomyRefreshRequired
                ? "Storefront taxonomy version 4 eBay-category refresh is required."
                : `Local differences: ${differences.join(", ")}.`
              : "Local listing matches active eBay inventory.",
        legacyProductId: local?.id || null,
        remoteQuantity: listing.quantity,
        localQuantity: local ? Number(local.quantity) : null,
        remotePrice: listing.price,
        localPrice: local ? Number(local.price) : null,
        sku: local?.sku || listing.sku,
        categoryName: listing.categoryName,
      } satisfies EbayStoreSyncAction;
    }),
    ...mergedRemote.aliasActions,
  ];
'''
source = source[:start] + actions_block + source[end:]
source = replace_once(
    source,
    "      if (!itemId || remoteByItemId.has(itemId)) continue;",
    "      if (\n        !itemId ||\n        rawRemoteByItemId.has(itemId) ||\n        effectiveRemoteByItemId.has(itemId)\n      )\n        continue;",
    "ended preview guard",
)
source = replace_once(
    source,
    "    const changedListings = remote.listings.filter((listing) => {",
    "    const changedListings = effectiveRemoteListings.filter((listing) => {",
    "effective changed listings",
)
source = replace_once(
    source,
    "      : remote.listings\n        .map((listing) => localByItemId.get(listing.itemId) || null)",
    "      : effectiveRemoteListings\n        .map((listing) => localByItemId.get(listing.itemId) || null)",
    "effective unchanged listings",
)
source = replace_once(
    source,
    "remoteByItemId.get(String(local.ebay_item_id))!",
    "effectiveRemoteByItemId.get(String(local.ebay_item_id))!",
    "effective remote lookup",
)
ended_pattern = re.compile(
    r"      const endedLocals = locals\.filter\(\s*\(local\) =>\s*!remoteByItemId\.has\(String\(local\.ebay_item_id \|\| \"\"\)\),\s*\);",
    re.S,
)
source, count = ended_pattern.subn(
    '''      const endedLocals = locals.filter((local) => {
        const itemId = String(local.ebay_item_id || "");
        return (
          !rawRemoteByItemId.has(itemId) &&
          !effectiveRemoteByItemId.has(itemId)
        );
      });''',
    source,
    count=1,
)
if count != 1:
    raise SystemExit(f"ended apply guard: expected one match, found {count}")
source = replace_once(
    source,
    "          authoritative_store_sync_last_eligible_cards:\n            remote.listings.length,\n          authoritative_store_sync_last_inserted: inserted,",
    "          authoritative_store_sync_last_eligible_cards:\n            remote.listings.length,\n          authoritative_store_sync_last_represented_inventory_rows:\n            effectiveRemoteListings.length,\n          authoritative_store_sync_last_merged_alias_listings:\n            mergedRemote.mergedAliasListings,\n          authoritative_store_sync_last_inserted: inserted,",
    "cursor metrics",
)
source = replace_once(
    source,
    "            eligible_cards: remote.listings.length,\n            inserted,",
    "            eligible_cards: remote.listings.length,\n            represented_inventory_rows: effectiveRemoteListings.length,\n            merged_alias_listings: mergedRemote.mergedAliasListings,\n            inserted,",
    "provider metrics",
)
source = replace_once(
    source,
    "    // Backward-compatible aliases for existing admin receipts.",
    "    mergedAliasListings: mergedRemote.mergedAliasListings,\n    representedInventoryRows: effectiveRemoteListings.length,\n    // Backward-compatible aliases for existing admin receipts.",
    "return metrics",
)
sync_path.write_text(source)

route_path = Path("src/app/api/cron/ebay-store-fixed-price-sync/route.ts")
route = route_path.read_text()
route = replace_once(
    route,
    "        skippedNonCollectibles: sync.skippedNonCollectibles,\n        inserted: sync.inserted,",
    "        skippedNonCollectibles: sync.skippedNonCollectibles,\n        mergedAliasListings: sync.mergedAliasListings,\n        representedInventoryRows: sync.representedInventoryRows,\n        inserted: sync.inserted,",
    "route summary",
)
route = replace_once(
    route,
    "    sync.unchanged === sync.eligibleCollectibles",
    "    sync.unchanged === sync.representedInventoryRows",
    "route convergence",
)
reconcile_end = '''      errors.push({
        step: "authoritative_full_store_sync",
        error: "The active eBay total did not reconcile to eligible plus intentionally excluded listings.",
      });
    }
'''
alias_reconcile = '''
    if (
      firstAuthoritative.cycleComplete &&
      firstAuthoritative.representedInventoryRows +
        firstAuthoritative.mergedAliasListings !==
        firstAuthoritative.eligibleCollectibles
    ) {
      errors.push({
        step: "authoritative_full_store_sync",
        error: "Represented inventory rows plus merged aliases did not reconcile to eligible eBay listings.",
      });
    }
'''
route = replace_once(route, reconcile_end, reconcile_end + alias_reconcile, "alias reconciliation")
route = replace_once(
    route,
    "      if (activeLinkedProducts !== finalAuthoritative.eligibleCollectibles) {",
    "      if (activeLinkedProducts !== finalAuthoritative.representedInventoryRows) {",
    "route audit condition",
)
route = replace_once(
    route,
    "          error: `Active linked database count ${activeLinkedProducts} does not equal current eligible eBay inventory ${finalAuthoritative.eligibleCollectibles}.`,",
    "          error: `Active linked database count ${activeLinkedProducts} does not equal represented eBay inventory ${finalAuthoritative.representedInventoryRows}.`,",
    "route audit error",
)
route = replace_once(
    route,
    "      activeLinkedProducts,\n      matchesEligibleEbayInventory:\n        finalAuthoritative !== null &&\n        activeLinkedProducts === finalAuthoritative.eligibleCollectibles,",
    "      activeLinkedProducts,\n      expectedActiveLinkedProducts:\n        finalAuthoritative?.representedInventoryRows ?? null,\n      matchesEligibleEbayInventory:\n        finalAuthoritative !== null &&\n        activeLinkedProducts === finalAuthoritative.representedInventoryRows,",
    "database audit receipt",
)
route_path.write_text(route)

backfill_path = Path("src/lib/ebay-fixed-price-backfill.ts")
backfill = backfill_path.read_text()
backfill = replace_once(
    backfill,
    'import { getStoreSettings } from "./store-settings";\nimport { InventoryRepository } from "../modules/inventory";',
    'import { getStoreSettings } from "./store-settings";\nimport {\n  isMergedEbayAliasItemId,\n  isMergedEbayListingMember,\n} from "./ebay-merged-listing-groups";\nimport { InventoryRepository } from "../modules/inventory";',
    "backfill imports",
)
function_start = backfill.index("async function upsertNewLegacyListing")
body_start = backfill.index(") {", function_start) + 3
backfill = (
    backfill[:body_start]
    + '''
  if (isMergedEbayAliasItemId(params.listing.itemId)) {
    return { inserted: false, reason: "merged_alias" };
  }
'''
    + backfill[body_start:]
)
loop_marker = "  for (const listing of listings) {\n    counters.checked += 1;\n"
backfill = replace_once(
    backfill,
    loop_marker,
    loop_marker
    + '''
    if (isMergedEbayListingMember(listing)) {
      counters.unchanged += 1;
      continue;
    }
''',
    "quantity merged-member guard",
)
backfill_path.write_text(backfill)

test_path = Path("scripts/run-storefront-taxonomy-regressions.ts")
test = test_path.read_text()
test = replace_once(
    test,
    'import { ebayAuthoritativeStoreSyncTestHelpers } from "../src/lib/ebay-authoritative-store-sync";\nimport { isLaunchCollectible } from "../src/lib/sports-card-launch-scope";',
    'import { ebayAuthoritativeStoreSyncTestHelpers } from "../src/lib/ebay-authoritative-store-sync";\nimport {\n  EBAY_MERGED_LISTING_GROUPS,\n  isMergedEbayAliasItemId,\n  isMergedEbayCanonicalProductId,\n} from "../src/lib/ebay-merged-listing-groups";\nimport { isLaunchCollectible } from "../src/lib/sports-card-launch-scope";',
    "test imports",
)
old_assertions = '''assert.ok(
  authoritativeSyncSource.includes(
    'import { listingImageIdentity } from "./listing-image-utils";',
  ),
  "Authoritative convergence must compare stable eBay image identities.",
);
assert.match(
  authoritativeSyncSource,
  /listingImageIdentity\(local\.image_url\) !==[\s\S]*listingImageIdentity\(remote\.imageUrl\)/,
  "Image resolution variants must not create endless inventory updates.",
);
assert.match(
  authoritativeSyncSource,
  /normalizedNullableText\(local\.sport\) !==[\s\S]*normalizedNullableText\(remote\.sport\)/,
  "Null and empty storefront category values must compare consistently.",
);'''
new_assertions = '''assert.match(
  authoritativeSyncSource,
  /function normalizedComparableText[\s\S]*\.normalize\("NFKC"\)/,
  "Equivalent Unicode and whitespace values must compare consistently.",
);
assert.match(
  authoritativeSyncSource,
  /function listingDifferences[\s\S]*differences\.push\("title"\)[\s\S]*differences\.push\("quantity"\)[\s\S]*differences\.push\("price"\)[\s\S]*differences\.push\("sport"\)/,
  "Field-level convergence diagnostics must remain deterministic.",
);
assert.ok(
  !authoritativeSyncSource.includes("listingImageIdentity(local.image_url)"),
  "Authoritative inventory and complete image reconciliation must not fight.",
);
assert.equal(EBAY_MERGED_LISTING_GROUPS[0].canonicalLegacyProductId, 1991);
assert.deepEqual([...EBAY_MERGED_LISTING_GROUPS[0].aliasItemIds], [
  "317570836168",
  "317570836334",
]);
assert.equal(isMergedEbayAliasItemId("317570836168"), true);
assert.equal(isMergedEbayCanonicalProductId(1991), true);
assert.match(
  authoritativeSyncSource,
  /function collapseMergedRemoteListings[\s\S]*mergedQuantity[\s\S]*mergedAliasListings/,
  "Merged eBay listings must aggregate into their canonical website inventory row.",
);
assert.ok(authoritativeSyncSource.includes("representedInventoryRows"));'''
test = replace_once(test, old_assertions, new_assertions, "replace obsolete assertions")
test += '''

const scheduledSyncSource = fs.readFileSync(
  "src/app/api/cron/ebay-store-fixed-price-sync/route.ts",
  "utf8",
);
const fixedPriceBackfillSource = fs.readFileSync(
  "src/lib/ebay-fixed-price-backfill.ts",
  "utf8",
);
assert.match(
  scheduledSyncSource,
  /sync\.unchanged === sync\.representedInventoryRows/,
  "Cron convergence must use represented website rows rather than raw alias listings.",
);
assert.match(
  scheduledSyncSource,
  /expectedActiveLinkedProducts[\s\S]*representedInventoryRows/,
  "Database audit must expose the alias-aware expected row count.",
);
assert.match(
  fixedPriceBackfillSource,
  /isMergedEbayAliasItemId\(params\.listing\.itemId\)/,
  "Backfill must not recreate merged aliases.",
);
assert.match(
  fixedPriceBackfillSource,
  /isMergedEbayListingMember\(listing\)/,
  "Quantity reconciliation must leave merged listing groups to the authoritative aggregate sync.",
);
'''
test_path.write_text(test)
