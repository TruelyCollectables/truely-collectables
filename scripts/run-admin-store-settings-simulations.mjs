import {
  ADMIN_EBAY_ENVIRONMENTS,
  adminStoreOperationalSettingsError,
  cleanAdminSettingsText,
  parseAdminEbayEnvironment,
  parseAdminSellerCommissionPercent,
  readableAdminStoreSettingsFailure,
} from "../src/lib/admin-store-settings.ts";

const scenarios = [];

function scenario(name, run) {
  scenarios.push({ name, run });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

scenario("cleans optional admin settings text", () => {
  assert(cleanAdminSettingsText(" support@example.com ") === "support@example.com", "Trims text.");
  assert(cleanAdminSettingsText("") === null, "Rejects empty string.");
  assert(cleanAdminSettingsText("   ") === null, "Rejects whitespace.");
  assert(cleanAdminSettingsText(null) === null, "Rejects non-string values.");
});

scenario("accepts valid seller commission percentages only", () => {
  assert(parseAdminSellerCommissionPercent("0") === 0, "Allows zero percent.");
  assert(parseAdminSellerCommissionPercent("8.25") === 8.25, "Allows decimal percent.");
  assert(parseAdminSellerCommissionPercent("100") === 100, "Allows 100 percent.");

  for (const value of ["", "   ", "-0.01", "100.01", "abc", null, undefined]) {
    assert(
      parseAdminSellerCommissionPercent(value) === null,
      `${String(value)} should be rejected.`,
    );
  }
});

scenario("accepts only supported eBay environments", () => {
  for (const environment of ADMIN_EBAY_ENVIRONMENTS) {
    assert(
      parseAdminEbayEnvironment(environment) === environment,
      `${environment} should parse.`,
    );
  }

  for (const value of ["staging", "prod", "PRODUCTION", 42]) {
    assert(parseAdminEbayEnvironment(value) === null, `${String(value)} should be rejected.`);
  }
});

scenario("returns operator-readable validation errors", () => {
  assert(
    adminStoreOperationalSettingsError({
      sellerCommissionPercent: "",
      ebayEnvironment: "production",
    }) === "Seller commission percent must be a number from 0 to 100.",
    "Blank commission should be rejected with a friendly error.",
  );

  assert(
    adminStoreOperationalSettingsError({
      sellerCommissionPercent: "8",
      ebayEnvironment: "staging",
    }) === "eBay environment must be production or sandbox.",
    "Unsupported environment should be rejected with a friendly error.",
  );

  assert(
    adminStoreOperationalSettingsError({
      sellerCommissionPercent: "8",
      ebayEnvironment: "sandbox",
    }) === null,
    "Valid operations settings should pass.",
  );
});

scenario("keeps unexpected save failures readable and bounded", () => {
  assert(
    readableAdminStoreSettingsFailure(new Error("database went sideways"), "fallback") ===
      "database went sideways",
    "Keeps useful errors.",
  );

  assert(
    readableAdminStoreSettingsFailure("not an error", "fallback") === "fallback",
    "Falls back for unknown errors.",
  );

  assert(
    readableAdminStoreSettingsFailure(new Error("x".repeat(300)), "fallback").length === 240,
    "Bounds URL-safe admin error length.",
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
  `Admin store settings simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`,
);

if (failed.length > 0) process.exitCode = 1;
