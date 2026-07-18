import {
  normalizeEbayDuplicateProductIds,
  planEbayDuplicateQuantityMerge,
} from "../src/lib/ebay-duplicate-merge.ts";
import { readFile } from "node:fs/promises";

const duplicateFinderSource = await readFile(
  new URL("../src/app/admin/ebay/duplicates/EbayDuplicateFinderClient.tsx", import.meta.url),
  "utf8",
);
const duplicateRouteSource = await readFile(
  new URL("../src/app/api/admin/ebay-duplicates/route.ts", import.meta.url),
  "utf8",
);

const scenarios = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectError(callback, expectedText) {
  try {
    callback();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(
      message.includes(expectedText),
      `Expected error containing "${expectedText}", received "${message}"`,
    );
    return;
  }

  throw new Error(`Expected error containing "${expectedText}", but nothing threw`);
}

async function scenario(name, callback) {
  const startedAt = Date.now();

  try {
    await callback();
    scenarios.push({ name, status: "passed", elapsedMs: Date.now() - startedAt });
  } catch (error) {
    scenarios.push({
      name,
      status: "failed",
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

await scenario("normalizes duplicate product IDs safely", () => {
  const ids = normalizeEbayDuplicateProductIds([
    42,
    "43",
    "43",
    0,
    -1,
    "abc",
    44.5,
    null,
  ]);

  assert(ids.join(",") === "42,43", "Only unique positive integer IDs should remain");
  assert(
    normalizeEbayDuplicateProductIds("55").join(",") === "55",
    "Scalar duplicateProductId should normalize to one ID",
  );
});

await scenario("plans multi-row duplicate quantity merge", () => {
  const plan = planEbayDuplicateQuantityMerge({
    keeperProductId: 100,
    keeperQuantity: 2,
    duplicateRows: [
      { productId: 101, quantity: 1 },
      { productId: 102, quantity: 3 },
    ],
  });

  assert(plan.keeperProductId === 100, "Keeper ID should be preserved");
  assert(
    plan.duplicateProductIds.join(",") === "101,102",
    "All non-keeper duplicate rows should be archived",
  );
  assert(plan.previousKeeperQuantity === 2, "Keeper quantity should be captured");
  assert(plan.duplicateQuantity === 4, "Duplicate quantities should be summed");
  assert(plan.mergedQuantity === 6, "Keeper should become 2 + 1 + 3 = 6");
  assert(plan.archivedDuplicateCount === 2, "Two duplicate rows should be archived");
});

await scenario("filters keeper and duplicate duplicate IDs from merge plan", () => {
  const plan = planEbayDuplicateQuantityMerge({
    keeperProductId: 100,
    keeperQuantity: "2.9",
    duplicateRows: [
      { productId: 100, quantity: 99 },
      { productId: 101, quantity: "1.7" },
      { productId: 101, quantity: 5 },
      { productId: 102, quantity: -4 },
    ],
  });

  assert(
    plan.duplicateProductIds.join(",") === "101,102",
    "Keeper and repeated duplicate IDs should be ignored",
  );
  assert(plan.previousKeeperQuantity === 2, "Fractional keeper quantity should floor");
  assert(plan.duplicateQuantity === 1, "Fractional/negative duplicate quantities should be bounded");
  assert(plan.mergedQuantity === 3, "Merged quantity should use sanitized whole quantities");
});

await scenario("rejects merge with no duplicate row different from keeper", () => {
  expectError(
    () =>
      planEbayDuplicateQuantityMerge({
        keeperProductId: 100,
        keeperQuantity: 2,
        duplicateRows: [{ productId: 100, quantity: 1 }],
      }),
    "Pick at least one duplicate",
  );
});

await scenario("duplicate finder previews destructive end and merge actions", () => {
  for (const fragment of [
    "type DuplicateAction",
    "Previewing merge...",
    "Merging now: keeper qty",
    "Previewing end/archive",
    "That row is marked as the keeper",
    "Ending now: product",
    "dryRun: true",
  ]) {
    assert(
      duplicateFinderSource.includes(fragment),
      `Expected duplicate finder action-safety fragment ${fragment}.`,
    );
  }
});

await scenario("duplicate API supports end/archive dry-run preview", () => {
  for (const fragment of [
    "previewArchiveDuplicate",
    "previousInventoryQuantity",
    "inventoryStatus",
    "body.dryRun === true",
    "will be archived to 0",
  ]) {
    assert(
      duplicateRouteSource.includes(fragment),
      `Expected duplicate route dry-run fragment ${fragment}.`,
    );
  }
});

const failed = scenarios.filter((item) => item.status === "failed");

for (const item of scenarios) {
  const prefix = item.status === "passed" ? "PASS" : "FAIL";
  const detail = item.error ? ` - ${item.error}` : "";
  console.log(`${prefix} ${item.name} (${item.elapsedMs}ms)${detail}`);
}

console.log(
  `eBay duplicate merge simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`,
);

if (failed.length > 0) process.exitCode = 1;
