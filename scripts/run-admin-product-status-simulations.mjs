import {
  ADMIN_INVENTORY_STATUSES,
  adminProductStatusChangeError,
  parseAdminInventoryStatus,
  parseAdminProductId,
} from "../src/lib/admin-product-status.ts";

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
