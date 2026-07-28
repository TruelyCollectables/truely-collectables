from pathlib import Path

SYNC = Path("src/lib/ebay-authoritative-store-sync.ts")
TEST = Path("scripts/run-storefront-taxonomy-regressions.ts")


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text()
    if new in text:
        print(f"Already applied: {label}")
        return
    if old not in text:
        raise SystemExit(f"Could not locate {label} in {path}")
    path.write_text(text.replace(old, new, 1))
    print(f"Applied: {label}")


replace_once(
    SYNC,
    "const APPLY_CONCURRENCY = 8;\n",
    "const APPLY_CONCURRENCY = 8;\nconst LOCAL_LINKED_PAGE_SIZE = 1000;\n",
    "local linked page size",
)

replace_once(
    SYNC,
    '''async function readAllRemoteListings(params: {
  environment: string;
  accessToken: string;
}) {
''',
    '''export async function collectPaginatedRows<T>(params: {
  pageSize?: number;
  fetchPage: (from: number, to: number) => Promise<T[]>;
}) {
  const pageSize = params.pageSize || LOCAL_LINKED_PAGE_SIZE;
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const page = await params.fetchPage(from, from + pageSize - 1);
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

async function readAllRemoteListings(params: {
  environment: string;
  accessToken: string;
}) {
''',
    "generic pagination helper",
)

replace_once(
    SYNC,
    '''function listingChanged(
  local: LocalProduct,
  remote: EbayStoreRemoteListing,
) {
''',
    '''async function readAllLocalLinkedProducts(params: {
  supabase: SupabaseClient;
  storeId: string;
}) {
  return collectPaginatedRows<LocalProduct>({
    fetchPage: async (from, to) => {
      const { data, error } = await params.supabase
        .from("products")
        .select(
          "id,seller_account_id,sku,title,description,price,quantity,image_url,ebay_item_id,sport,last_seen_at",
        )
        .eq("store_id", params.storeId)
        .not("ebay_item_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw error;
      return (data || []) as LocalProduct[];
    },
  });
}

function syncErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message.slice(0, 500);
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const detail = record.message || record.details || record.hint || record.code;
    if (detail) return String(detail).replace(/\\s+/g, " ").slice(0, 500);
  }
  return fallback;
}

function listingChanged(
  local: LocalProduct,
  remote: EbayStoreRemoteListing,
) {
''',
    "all local linked products reader",
)

replace_once(
    SYNC,
    '''  const { data: localRows, error: localError } = await params.supabase
    .from("products")
    .select(
      "id,seller_account_id,sku,title,description,price,quantity,image_url,ebay_item_id,sport,last_seen_at",
    )
    .eq("store_id", params.storeId)
    .not("ebay_item_id", "is", null);
  if (localError) throw localError;

  const locals = (localRows || []) as LocalProduct[];
''',
    '''  const locals = await readAllLocalLinkedProducts(params);
''',
    "replace truncated local read",
)

replace_once(
    SYNC,
    '''          error:
            error instanceof Error
              ? error.message
              : "Unknown sync failure.",
''',
    '''          error: syncErrorMessage(error, "Unknown sync failure."),
''',
    "sanitized upsert error detail",
)

replace_once(
    SYNC,
    '''            error:
              error instanceof Error
                ? error.message
                : "Unknown deactivate failure.",
''',
    '''            error: syncErrorMessage(error, "Unknown deactivate failure."),
''',
    "sanitized deactivate error detail",
)

replace_once(
    SYNC,
    '''export const ebayAuthoritativeStoreSyncTestHelpers = {
  parseRemoteListing,
''',
    '''export const ebayAuthoritativeStoreSyncTestHelpers = {
  collectPaginatedRows,
  parseRemoteListing,
''',
    "pagination test helper export",
)

replace_once(
    TEST,
    '''console.log("Storefront taxonomy regressions passed.");
''',
    '''const paginationRequests: Array<[number, number]> = [];
const paginatedRows = await ebayAuthoritativeStoreSyncTestHelpers.collectPaginatedRows<number>({
  fetchPage: async (from, to) => {
    paginationRequests.push([from, to]);
    if (from === 0) return Array.from({ length: 1000 }, (_, index) => index);
    if (from === 1000) return Array.from({ length: 1000 }, (_, index) => 1000 + index);
    if (from === 2000) return Array.from({ length: 153 }, (_, index) => 2000 + index);
    return [];
  },
});
assert.equal(paginatedRows.length, 2153);
assert.deepEqual(paginationRequests, [[0, 999], [1000, 1999], [2000, 2999]]);
assert.equal(paginatedRows[0], 0);
assert.equal(paginatedRows.at(-1), 2152);

console.log("Storefront taxonomy regressions passed.");
''',
    "local pagination regression",
)

print("eBay local pagination fix applied")
