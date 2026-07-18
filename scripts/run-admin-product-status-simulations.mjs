import {
  ADMIN_INVENTORY_STATUSES,
  adminProductStatusChangeError,
  adminProductStatusPendingLabel,
  adminProductStatusRequiresStock,
  adminProductStatusSuccessMessage,
  parseAdminInventoryStatus,
  parseAdminProductId,
} from "../src/lib/admin-product-status.ts";
import { readFile } from "node:fs/promises";

const productPageSource = await readFile(
  new URL("../src/app/admin/products/[id]/page.tsx", import.meta.url),
  "utf8",
);
const productSaveRouteSource = await readFile(
  new URL("../src/app/api/admin/products/[id]/save/route.ts", import.meta.url),
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
    adminProductStatusPendingLabel("archived") === "Ending / archiving...",
    "Archive should get an explicit pending label.",
  );
  assert(
    adminProductStatusSuccessMessage("sold") ===
      "Product is marked sold and quantity was set to 0.",
    "Sold should explain quantity side effect.",
  );
  assert(
    adminProductStatusSuccessMessage("archived") ===
      "Product was ended/archived and removed from active inventory.",
    "Archive should explain active inventory removal.",
  );
});

scenario("product quick-status UI reports status success and stock blockers", () => {
  for (const fragment of [
    "statusSaved",
    "adminProductStatusSuccessMessage(savedStatus)",
    "aria-live=\"polite\"",
    "aria-live=\"assertive\"",
    "Qty required first",
    "Quantity must be at least 1 before",
    "adminProductStatusPendingLabel(status)",
  ]) {
    assert(
      productPageSource.includes(fragment),
      `Expected product status UI fragment ${fragment}.`,
    );
  }
});

scenario("inventory engine enforces admin product status policy", () => {
  for (const fragment of [
    "adminProductStatusChangeError",
    "quantity: current.quantity",
    "throw new InventoryEngineError(statusError, 400)",
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
    "quantity,",
    "saveError: statusError",
  ]) {
    assert(
      productSaveRouteSource.includes(fragment),
      `Expected product save route status-policy fragment ${fragment}.`,
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
