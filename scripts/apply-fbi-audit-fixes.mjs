import fs from "node:fs";

function replaceExact(file, before, after, expectedCount = 1) {
  const source = fs.readFileSync(file, "utf8");
  const count = source.split(before).length - 1;
  if (count !== expectedCount) {
    throw new Error(`${file}: expected ${expectedCount} exact match(es), found ${count}`);
  }
  fs.writeFileSync(file, source.replaceAll(before, after));
  console.log(`PATCH ${file}: ${count} replacement(s)`);
}

replaceExact(
  "scripts/check-production-guardrails.mjs",
  'packageJson.dependencies?.next !== "16.2.10" ||\n  packageJson.devDependencies?.["eslint-config-next"] !== "16.2.10"',
  'packageJson.dependencies?.next !== "16.2.12" ||\n  packageJson.devDependencies?.["eslint-config-next"] !== "16.2.12"',
);
replaceExact(
  "scripts/check-production-guardrails.mjs",
  "Next.js and eslint-config-next must stay aligned on patched release 16.2.10.",
  "Next.js and eslint-config-next must stay aligned on patched release 16.2.12.",
);
replaceExact(
  "scripts/check-production-guardrails.mjs",
  'packageJson.overrides?.postcss !== "8.5.15"',
  'packageJson.overrides?.postcss !== "8.5.23"',
);
replaceExact(
  "scripts/check-production-guardrails.mjs",
  "package.json must keep PostCSS 8.5.15 overridden until Next.js stops pinning the vulnerable 8.4.31 release.",
  "package.json must keep PostCSS 8.5.23 overridden until the framework dependency chain no longer requires an explicit patched override.",
);

replaceExact(
  "scripts/run-admin-product-status-simulations.mjs",
  'HeaderStat label=\\"Scanner\\"',
  'HeaderStat label=\\"Upload\\"',
);
replaceExact(
  "scripts/run-admin-product-status-simulations.mjs",
  'HeaderStat label=\\"Manual\\"',
  'HeaderStat label=\\"AI\\"',
);
replaceExact(
  "scripts/run-admin-product-status-simulations.mjs",
  "marketplace publishing remains a separate admin step",
  "Adds the product to TCOS inventory only",
);

replaceExact(
  "scripts/run-live-production-surface-audit.mjs",
  "  /this page could not be found/i,\n",
  "",
);

replaceExact(
  "scripts/run-dual-marketplace-edge-audit-simulations.ts",
  `assert.match(\n  studio,\n  /window\\.confirm/,\n  "Real eBay publishing must require explicit operator confirmation.",\n);`,
  `assert.doesNotMatch(\n  studio,\n  /window\\.confirm/,\n  "Real eBay publishing must not rely on a browser confirm dialog.",\n);\nassert.match(\n  studio,\n  /pendingEbayConfirmation/,\n  "Real eBay publishing must require explicit inline operator confirmation.",\n);\nassert.match(\n  studio,\n  /Confirm REAL eBay publish/,\n  "The inline confirmation must clearly identify the real marketplace action.",\n);`,
);

const studioFile =
  "src/app/admin/products/new/AuditedDualMarketplaceListingStudio.tsx";
replaceExact(
  studioFile,
  `type ActionError = {\n  inventoryItemId?: string;\n  title?: string;\n  error?: string;\n  externalPublished?: boolean;\n  ebayListingId?: string | null;\n};`,
  `type ActionError = {\n  inventoryItemId?: string;\n  title?: string;\n  error?: string;\n  externalPublished?: boolean;\n  ebayListingId?: string | null;\n};\n\ntype PendingEbayConfirmation = {\n  action: \"publish-ebay\" | \"publish-both\";\n  inventoryItemIds: string[];\n  itemCount: number;\n  totalAskingPrice: number;\n};`,
);
replaceExact(
  studioFile,
  `  const [notice, setNotice] = useState(\"\");\n  const [error, setError] = useState(\"\");`,
  `  const [notice, setNotice] = useState(\"\");\n  const [error, setError] = useState(\"\");\n  const [pendingEbayConfirmation, setPendingEbayConfirmation] =\n    useState<PendingEbayConfirmation | null>(null);`,
);
replaceExact(
  studioFile,
  `  const busy = Boolean(workingAction);`,
  `  const busy = Boolean(workingAction || pendingEbayConfirmation);`,
);
replaceExact(
  studioFile,
  `  async function runAction(action: DualMarketplaceAction) {\n    if (busy) return;\n    const targetRows = selectedRows.slice();`,
  `  async function runAction(\n    action: DualMarketplaceAction,\n    confirmedInventoryItemIds?: string[],\n  ) {\n    if (workingActionRef.current) return;\n    const requestedIds = confirmedInventoryItemIds || selectedIds;\n    const requestedIdSet = new Set(requestedIds);\n    const targetRows = rowsRef.current.filter((row) =>\n      requestedIdSet.has(row.inventoryItemId),\n    );`,
);
replaceExact(
  studioFile,
  `    if (includesEbay) {\n      const total = targetRows.reduce((sum, row) => sum + row.ebayPrice, 0);\n      const confirmed = window.confirm(\n        \`Create or update \${targetRows.length} REAL eBay listing\${\n          targetRows.length === 1 ? \"\" : \"s\"\n        } with \${money(total)} in combined asking prices? TCOS will process them in safe five-card batches.\`,\n      );\n      if (!confirmed) return;\n    }\n\n    workingActionRef.current = action;`,
  `    if (includesEbay && !confirmedInventoryItemIds) {\n      setPendingEbayConfirmation({\n        action,\n        inventoryItemIds: targetRows.map((row) => row.inventoryItemId),\n        itemCount: targetRows.length,\n        totalAskingPrice: targetRows.reduce(\n          (sum, row) => sum + row.ebayPrice,\n          0,\n        ),\n      });\n      setNotice(\"\");\n      setError(\"\");\n      return;\n    }\n\n    setPendingEbayConfirmation(null);\n    workingActionRef.current = action;`,
);
replaceExact(
  studioFile,
  `        </div>\n\n        {notice ? (`,
  `        </div>\n\n        {pendingEbayConfirmation ? (\n          <section\n            role=\"alertdialog\"\n            aria-labelledby=\"ebay-publish-confirmation-title\"\n            aria-describedby=\"ebay-publish-confirmation-detail\"\n            className=\"mt-4 rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 shadow-sm\"\n          >\n            <h3\n              id=\"ebay-publish-confirmation-title\"\n              className=\"text-lg font-black text-neutral-950\"\n            >\n              Confirm REAL eBay publish\n            </h3>\n            <p\n              id=\"ebay-publish-confirmation-detail\"\n              className=\"mt-2 text-sm font-bold leading-6 text-neutral-800\"\n            >\n              This will create or update {pendingEbayConfirmation.itemCount} real eBay\n              listing{pendingEbayConfirmation.itemCount === 1 ? \"\" : \"s\"} with{\" \"}\n              {money(pendingEbayConfirmation.totalAskingPrice)} in combined asking\n              prices. TCOS will process the selection in safe five-card batches.\n            </p>\n            <div className=\"mt-4 flex flex-wrap gap-3\">\n              <button\n                type=\"button\"\n                onClick={() => setPendingEbayConfirmation(null)}\n                className=\"rounded-xl border border-neutral-400 bg-white px-4 py-2 text-sm font-black text-neutral-900 hover:bg-neutral-100\"\n              >\n                Cancel\n              </button>\n              <button\n                type=\"button\"\n                onClick={() => {\n                  const confirmation = pendingEbayConfirmation;\n                  setPendingEbayConfirmation(null);\n                  void runAction(\n                    confirmation.action,\n                    confirmation.inventoryItemIds,\n                  );\n                }}\n                className=\"rounded-xl bg-neutral-950 px-5 py-2 text-sm font-black text-white hover:bg-neutral-800\"\n              >\n                Confirm and publish to eBay\n              </button>\n            </div>\n          </section>\n        ) : null}\n\n        {notice ? (`,
);

console.log("FBI/CIA audit fixes applied successfully.");
