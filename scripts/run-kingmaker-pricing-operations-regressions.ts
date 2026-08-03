import assert from "node:assert/strict";
import {
  comparePricingReceipts,
  filterAndPaginatePricingReceipts,
} from "../src/lib/kingmaker-pricing-operations-query";
import {
  pricingReceiptsToCsv,
  summarizePricingReceipts,
} from "../src/lib/kingmaker-pricing-receipt-operations";

const receipts = [
  {
    id: "r1", identityId: "card-a", status: "ready" as const,
    suggestedListPrice: 100, buyCeiling: 60, estimatedNetProceeds: 82,
    estimatedProfitAtCeiling: 22, confidence: 0.92, soldCompCount: 5,
    createdAt: "2026-08-01T12:00:00Z", pricingProfile: { name: "Cards" },
  },
  {
    id: "r2", identityId: "card-b", status: "review_required" as const,
    suggestedListPrice: null, buyCeiling: null, estimatedNetProceeds: null,
    estimatedProfitAtCeiling: null, confidence: 0.4, soldCompCount: 1,
    createdAt: "2026-08-02T12:00:00Z", pricingProfile: { name: "Review" },
  },
  {
    id: "r3", identityId: "shoe-a", status: "ready" as const,
    suggestedListPrice: 150, buyCeiling: 90, estimatedNetProceeds: 123,
    estimatedProfitAtCeiling: 33, confidence: 0.88, soldCompCount: 6,
    createdAt: "2026-08-03T12:00:00Z", pricingProfile: { name: "Shoes" },
  },
];

const filtered = filterAndPaginatePricingReceipts(receipts, {
  status: "ready",
  minEstimatedProfit: 25,
  profileName: "shoe",
  page: 1,
  pageSize: 10,
});
assert.deepEqual(filtered.rows.map((row) => row.id), ["r3"]);
assert.equal(filtered.pagination.totalRows, 1);
assert.equal(filtered.pagination.hasNextPage, false);

const paged = filterAndPaginatePricingReceipts(receipts, { page: 2, pageSize: 1 });
assert.equal(paged.rows[0]?.id, "r2");
assert.equal(paged.pagination.totalPages, 3);

const comparison = comparePricingReceipts(receipts, ["r1", "r3", "missing"]);
assert.equal(comparison.matchedCount, 2);
assert.equal(comparison.bestEstimatedProfitReceiptId, "r3");
assert.equal(comparison.highestConfidenceReceiptId, "r1");
assert.equal(comparison.boundary, "advisory_only");

const summary = summarizePricingReceipts(receipts);
assert.equal(summary.totalDecisions, 3);
assert.equal(summary.ready, 2);
assert.equal(summary.totalEstimatedProfitAtCeiling, 55);

const csv = pricingReceiptsToCsv(receipts);
assert.match(csv, /^receipt_id,identity_id,status/);
assert.doesNotMatch(csv, /store_id|seller_account_id|provider|source/i);
assert.match(csv, /r1,card-a,ready/);

console.log("KINGMAKER Pricing operations bundle regressions passed.");
