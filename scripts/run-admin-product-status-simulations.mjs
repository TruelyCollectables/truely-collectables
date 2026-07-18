import {
  ADMIN_INVENTORY_STATUSES,
  adminProductActionFailureMessage,
  adminProductStatusChangeError,
  adminProductStatusPendingLabel,
  adminProductStatusNormalizedQuantity,
  adminProductStatusRequiresStock,
  adminProductStatusSuccessMessage,
  adminProductStatusZeroesQuantity,
  parseAdminInventoryStatus,
  parseAdminProductId,
} from "../src/lib/admin-product-status.ts";
import { readFile } from "node:fs/promises";

const productPageSource = await readFile(
  new URL("../src/app/admin/products/[id]/page.tsx", import.meta.url),
  "utf8",
);
const productsPageSource = await readFile(
  new URL("../src/app/admin/products/page.tsx", import.meta.url),
  "utf8",
);
const productSaveRouteSource = await readFile(
  new URL("../src/app/api/admin/products/[id]/save/route.ts", import.meta.url),
  "utf8",
);
const adminProductStatusSource = await readFile(
  new URL("../src/lib/admin-product-status.ts", import.meta.url),
  "utf8",
);
const inventoryEngineSource = await readFile(
  new URL("../src/modules/inventory/engine.ts", import.meta.url),
  "utf8",
);

const scenarios = [];

function scenario(name, run) {
  scenarios.push({ name, run });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

scenario("accepts only supported admin inventory statuses", () => {
  for (const status of ADMIN_INVENTORY_STATUSES) {
    assert(parseAdminInventoryStatus(status) === status, `${status} should parse`);
  }

  for (const status of ["", "deleted", "live", "pending", "ACTIVE"]) {
    assert(parseAdminInventoryStatus(status) === null, `${status} should be rejected`);
  }
});

scenario("requires positive integer product IDs", () => {
  assert(parseAdminProductId("42") === 42, "String integer should parse");
  assert(parseAdminProductId(42) === 42, "Number integer should parse");

  for (const value of [0, -1, "abc", "4.5", null, undefined]) {
    assert(parseAdminProductId(value) === null, `${String(value)} should be rejected`);
  }
});

scenario("returns operator-readable quick status errors", () => {
  assert(
    adminProductStatusChangeError({ productId: "abc", status: "active" }) ===
      "Invalid product ID.",
    "Invalid IDs should get a product ID error.",
  );
  assert(
    adminProductStatusChangeError({ productId: 12, status: "deleted" }) ===
      "Unsupported inventory status.",
    "Invalid statuses should get a status error.",
  );
  assert(
    adminProductStatusChangeError({ productId: 12, status: "archived" }) === null,
    "Valid status changes should pass.",
  );
});

scenario("sanitizes unexpected product action failures for operators", () => {
  assert(
    adminProductActionFailureMessage(new Error("PGRST116 raw table failure"), "Could not save product.") ===
      "Could not save product. Refresh products and try again. If it repeats, open Production Smoke and check server logs.",
    "Unexpected backend errors should be replaced with recovery guidance.",
  );
  assert(
    adminProductActionFailureMessage(
      new Error("Set quantity to at least 1 before marking this product active or reserved."),
      "Could not save product.",
    ) === "Set quantity to at least 1 before marking this product active or reserved.",
    "Known validation errors should stay specific.",
  );
});

scenario("requires stock before making inventory active or reserved", () => {
  for (const status of ["active", "reserved"]) {
    assert(
      adminProductStatusRequiresStock(status),
      `${status} should require stock.`,
    );
    assert(
      adminProductStatusChangeError({
        productId: 12,
        status,
        quantity: 0,
      }) ===
        "Set quantity to at least 1 before marking this product active or reserved.",
      `${status} should reject zero-quantity activation.`,
    );
  }

  assert(
    adminProductStatusChangeError({
      productId: 12,
      status: "archived",
      quantity: 0,
    }) === null,
    "Archive should still be allowed with zero quantity.",
  );
  assert(
    adminProductStatusChangeError({
      productId: 12,
      status: "sold",
      quantity: 0,
    }) === null,
    "Sold should still be allowed with zero quantity.",
  );
});

scenario("exposes explicit pending and success copy for destructive statuses", () => {
  assert(
    adminProductStatusPendingLabel("archived") === "Ending item...",
    "Archive should get an explicit pending label.",
  );
  assert(
    adminProductStatusSuccessMessage("sold") ===
      "Product is marked sold and quantity was set to 0.",
    "Sold should explain quantity side effect.",
  );
  assert(
    adminProductStatusSuccessMessage("archived") ===
      "Product was ended/archived, removed from active inventory, and quantity was set to 0.",
    "Archive should explain active inventory removal.",
  );
});

scenario("normalizes ended inventory statuses to zero quantity", () => {
  for (const status of ["sold", "archived"]) {
    assert(adminProductStatusZeroesQuantity(status), `${status} should zero quantity.`);
    assert(
      adminProductStatusNormalizedQuantity({ status, quantity: 3 }) === 0,
      `${status} should normalize positive quantity to 0.`,
    );
  }

  assert(
    adminProductStatusNormalizedQuantity({ status: "active", quantity: 3 }) === 3,
    "Active inventory should keep positive quantity.",
  );
});

scenario("product quick-status UI reports status success and stock blockers", () => {
  for (const fragment of [
    "statusSaved",
    "adminProductStatusSuccessMessage(savedStatus)",
    'role="status"',
    'role="alert"',
    "aria-live=\"polite\"",
    "aria-live=\"assertive\"",
    "Qty required first",
    "Quantity must be at least 1 before",
    "disabledReason={isDisabled ? title : undefined}",
    "adminProductStatusPendingLabel(status)",
    "End Early / Archive",
    "Sold and archived actions intentionally remove the item from buyer",
    "const removesFromInventory = status === \"sold\" || status === \"archived\"",
    "Mark Sold / Zero Qty",
    "End Early / Archive / Zero Qty",
    "Ends this product early, archives it, removes it from active inventory, and sets quantity to 0.",
    "Marks this product sold, removes it from buyer availability, and sets quantity to 0.",
    "border border-rose-300 bg-rose-50 text-rose-950 hover:bg-rose-100",
  ]) {
    assert(
      productPageSource.includes(fragment),
      `Expected product status UI fragment ${fragment}.`,
    );
  }
});

scenario("product pages avoid raw action failure copy", () => {
  for (const fragment of [
    "adminProductActionFailureMessage",
    "Product action needs attention:",
    "Refresh products and try again. If it repeats, open Production Smoke and check server logs.",
  ]) {
    assert(
      productPageSource.includes(fragment) ||
        productsPageSource.includes(fragment) ||
        productSaveRouteSource.includes(fragment) ||
        adminProductStatusSource.includes(fragment) ||
        inventoryEngineSource.includes(fragment),
      `Expected product action safety fragment ${fragment}.`,
    );
  }

  for (const fragment of [
    "readableProductActionFailure",
    "Product action failed:",
    "Save failed:",
    "error.message.trim()",
    "error?.message || \"Could not save product.\"",
  ]) {
    assert(
      !productPageSource.includes(fragment) &&
        !productsPageSource.includes(fragment) &&
        !productSaveRouteSource.includes(fragment),
      `Expected product admin pages to avoid raw failure fragment ${fragment}.`,
    );
  }
});

scenario("product list exposes a direct end-early action", () => {
  for (const fragment of [
    "async function endProductEarly",
    "adminProductStatusZeroesQuantity(product.status)",
    "status: \"archived\"",
    "statusEnded",
    'role="status"',
    'role="alert"',
    'aria-live="assertive"',
    "End early",
    "End early / qty 0",
    "Ended / Sold",
    "Ended / Archived",
    "archive it, and set quantity to 0",
    "Archives the product, removes it from active inventory,",
    "adminProductStatusSuccessMessage(\"archived\")",
    "Review ended product",
    "Continue inventory review",
    "href={`/admin/products/${query.statusEnded}`}",
  ]) {
    assert(
      productsPageSource.includes(fragment),
      `Expected products list end-early fragment ${fragment}.`,
    );
  }
});

scenario("inventory engine enforces admin product status policy", () => {
  for (const fragment of [
    "adminProductStatusChangeError",
    "adminProductStatusNormalizedQuantity",
    "quantity: current.quantity",
    "throw new InventoryEngineError(statusError, 400)",
    "const nextQuantity = adminProductStatusNormalizedQuantity",
  ]) {
    assert(
      inventoryEngineSource.includes(fragment),
      `Expected inventory engine status-policy fragment ${fragment}.`,
    );
  }
});

scenario("full product save blocks active or reserved zero-quantity records", () => {
  for (const fragment of [
    "adminProductStatusChangeError",
    "adminProductStatusNormalizedQuantity",
    "quantity,",
    "saveError: statusError",
    "quantity: normalizedQuantity",
  ]) {
    assert(
      productSaveRouteSource.includes(fragment),
      `Expected product save route status-policy fragment ${fragment}.`,
    );
  }
});

scenario("product suggested-price action preserves authenticity fields", () => {
  const actionStart = productPageSource.indexOf("async function applySuggestedPrice");
  const actionEnd = productPageSource.indexOf("  } catch (error)", actionStart);
  const actionSource = productPageSource.slice(actionStart, actionEnd);

  assert(actionStart >= 0 && actionEnd > actionStart, "Expected applySuggestedPrice source.");

  for (const fragment of [
    "await adminInventoryEngine.updateProduct(id, {",
    "price: suggestedPrice",
    "authenticity: product.authenticity",
  ]) {
    assert(
      actionSource.includes(fragment),
      `Expected suggested-price action fragment ${fragment}.`,
    );
  }
});

scenario("inventory engine validates before mutating product records", () => {
  const updateProductStart = inventoryEngineSource.indexOf("  async updateProduct(");
  const updateProductEnd = inventoryEngineSource.indexOf(
    "  async regenerateDescription",
    updateProductStart,
  );
  const updateProductSource = inventoryEngineSource.slice(
    updateProductStart,
    updateProductEnd,
  );
  const validationIndex = updateProductSource.indexOf(
    "const statusError = adminProductStatusChangeError",
  );
  const productMutationIndex = updateProductSource.indexOf(
    'const { data: product, error } = await this.database',
  );
  const authenticityIndex = updateProductSource.indexOf(
    "const authenticityError = validateAuthenticityProfile",
  );

  assert(updateProductStart >= 0 && updateProductEnd > updateProductStart, "Expected updateProduct source.");
  assert(validationIndex >= 0, "Expected updateProduct status validation.");
  assert(authenticityIndex >= 0, "Expected updateProduct authenticity validation.");
  assert(productMutationIndex >= 0, "Expected updateProduct product mutation.");
  assert(
    validationIndex < productMutationIndex,
    "Status validation should happen before product mutation.",
  );
  assert(
    authenticityIndex < productMutationIndex,
    "Authenticity validation should happen before product mutation.",
  );
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
  `Admin product status simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`,
);

if (failed.length > 0) process.exitCode = 1;
