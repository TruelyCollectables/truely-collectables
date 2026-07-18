import {
  adminBulkDescriptionBlockedReason,
  adminBulkDescriptionSelectionSummary,
  adminBulkDescriptionSubmitLabel,
} from "../src/lib/admin-product-bulk.ts";
import { readFile } from "node:fs/promises";

const bulkEditorSource = await readFile(
  new URL("../src/app/admin/products/BulkDescriptionEditor.tsx", import.meta.url),
  "utf8",
);

const scenarios = [];

function scenario(name, run) {
  scenarios.push({ name, run });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

scenario("blocks bulk description submit without loaded products", () => {
  assert(
    adminBulkDescriptionBlockedReason({
      description: "Ship fast",
      productCount: 0,
      selectedCount: 1,
    }) === "No products are loaded for bulk description updates.",
    "Expected empty product list to block bulk description updates.",
  );
});

scenario("blocks bulk description submit without selected products", () => {
  assert(
    adminBulkDescriptionBlockedReason({
      description: "Ship fast",
      productCount: 12,
      selectedCount: 0,
    }) === "Select at least one product before applying a bulk description.",
    "Expected missing selection to block bulk description updates.",
  );
});

scenario("blocks bulk description submit without description text", () => {
  assert(
    adminBulkDescriptionBlockedReason({
      description: "   ",
      productCount: 12,
      selectedCount: 2,
    }) === "Paste description text before applying it to selected products.",
    "Expected blank description to block bulk description updates.",
  );
});

scenario("labels bulk description submit with selected count", () => {
  assert(
    adminBulkDescriptionSubmitLabel({ pending: false, selectedCount: 3 }) ===
      "Apply To Selected (3)",
    "Expected idle bulk submit label to include selected count.",
  );
  assert(
    adminBulkDescriptionSubmitLabel({ pending: true, selectedCount: 1 }) ===
      "Saving descriptions for 1 selected product...",
    "Expected pending bulk submit label to be specific.",
  );
});

scenario("summarizes selected and filtered product counts", () => {
  assert(
    adminBulkDescriptionSelectionSummary({
      filteredCount: 7,
      productCount: 21,
      selectedCount: 4,
    }) === "4 selected · showing 7/21",
    "Expected selected/showing summary.",
  );
});

scenario("bulk description editor exposes searchable safe bulk controls", () => {
  for (const fragment of [
    "type=\"search\"",
    "filteredProducts",
    "adminBulkDescriptionBlockedReason",
    "Bulk update blocked:",
    'role="status"',
    "aria-busy={pending}",
    "aria-live=\"polite\"",
    "Select every product currently visible",
    "Clear the products currently visible",
    "adminBulkDescriptionSubmitLabel",
    "No products match",
    "aria-label={`Select ${product.title} for bulk description update`}",
  ]) {
    assert(
      bulkEditorSource.includes(fragment),
      `Expected bulk editor safety fragment ${fragment}.`,
    );
  }
});

const failed = [];

for (const item of scenarios) {
  try {
    item.run();
    console.log(`✓ ${item.name}`);
  } catch (error) {
    failed.push(item.name);
    console.error(`✗ ${item.name}`);
    console.error(error);
  }
}

console.log(
  `Admin product bulk simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`,
);

if (failed.length > 0) process.exitCode = 1;
