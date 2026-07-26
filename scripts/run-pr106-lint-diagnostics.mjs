import { ESLint } from "eslint";

const files = [
  "src/app/api/account/seller/inventory/instacomp/route.ts",
  "src/app/api/admin/ebay/full-store-sync/route.ts",
  "src/app/api/cron/ebay-store-fixed-price-sync/route.ts",
  "src/app/api/ebay/import-listings/route.ts",
  "src/app/seller/inventory/InstaCompStoreActions.tsx",
  "src/app/seller/inventory/layout.tsx",
  "src/lib/ebay-all-image-sync.ts",
  "src/lib/listing-image-utils.ts",
  "scripts/run-ebay-import-admin-client-simulations.ts",
];

const eslint = new ESLint();
const results = await eslint.lintFiles(files);
const formatter = await eslint.loadFormatter("stylish");
const output = await formatter.format(results);

console.log("=== PR 106 LINT DIAGNOSTICS ===");
console.log(output || "No lint errors or warnings in changed files.");
console.log(
  JSON.stringify(
    {
      errors: results.reduce((sum, result) => sum + result.errorCount, 0),
      warnings: results.reduce((sum, result) => sum + result.warningCount, 0),
    },
    null,
    2,
  ),
);
