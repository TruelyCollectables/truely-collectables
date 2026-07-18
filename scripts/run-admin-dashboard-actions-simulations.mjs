import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const adminRoot = path.join(repoRoot, "src/app/admin");

const adminPageSource = await readFile(
  new URL("../src/app/admin/page.tsx", import.meta.url),
  "utf8",
);
const adminInventoryPageSource = await readFile(
  new URL("../src/app/admin/inventory/page.tsx", import.meta.url),
  "utf8",
);
const adminCategoryReviewPageSource = await readFile(
  new URL("../src/app/admin/inventory/category-review/page.tsx", import.meta.url),
  "utf8",
);
const adminAccountsPageSource = await readFile(
  new URL("../src/app/admin/accounts/page.tsx", import.meta.url),
  "utf8",
);
const adminFilesPageSource = await readFile(
  new URL("../src/app/admin/files/page.tsx", import.meta.url),
  "utf8",
);
const adminOrdersPageSource = await readFile(
  new URL("../src/app/admin/orders/page.tsx", import.meta.url),
  "utf8",
);
const adminNewProductPageSource = await readFile(
  new URL("../src/app/admin/products/new/page.tsx", import.meta.url),
  "utf8",
);
const adminErrorSource = await readFile(
  new URL("../src/app/admin/error.tsx", import.meta.url),
  "utf8",
);
const instaCompDirectSource = await readFile(
  new URL("../src/app/admin/instacomp-direct/page.tsx", import.meta.url),
  "utf8",
);
const instaCompFrameSource = await readFile(
  new URL("../src/app/admin/instacomp/InstaCompAdminFrame.tsx", import.meta.url),
  "utf8",
);
const adminRouteCheckSource = await readFile(
  new URL("../scripts/check-admin-routes.mjs", import.meta.url),
  "utf8",
);
const adminControlCheckSource = await readFile(
  new URL("../scripts/check-admin-controls.mjs", import.meta.url),
  "utf8",
);
const adminRuntimeSmokeSource = await readFile(
  new URL("../scripts/smoke-admin-runtime.mjs", import.meta.url),
  "utf8",
);

const scenarios = [];
const adminDashboardLinkExemptions = new Set(["/admin", "/admin/login"]);
const adminNoDeadEndExemptions = new Set(["/admin", "/admin/login"]);
const sharedShellNavigationGuards = [
  {
    component: "InstaCompAdminFrame",
    source: instaCompFrameSource,
    requiredFragments: [
      'href: "/admin"',
      'href: "/admin/products"',
      'href: "/admin/ebay/duplicates"',
      'href: "/admin/production-smoke"',
    ],
  },
];

async function walkFiles(dir, matcher) {
  const entries = await readdir(dir);
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stats = await stat(fullPath);

    if (stats.isDirectory()) {
      files.push(...(await walkFiles(fullPath, matcher)));
    } else if (stats.isFile() && matcher(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function adminRouteFromPageFile(filePath) {
  const relative = path.relative(adminRoot, filePath);
  const parts = relative.split(path.sep);
  parts.pop();
  const routeWithoutPage = parts.filter(Boolean).join("/");

  return routeWithoutPage ? `/admin/${routeWithoutPage}` : "/admin";
}

const adminPageFiles = await walkFiles(adminRoot, (filePath) =>
  filePath.endsWith(`${path.sep}page.tsx`),
);
const adminPageEntries = await Promise.all(
  adminPageFiles.map(async (filePath) => ({
    filePath,
    route: adminRouteFromPageFile(filePath),
    source: await readFile(filePath, "utf8"),
  })),
);
const staticAdminPageRoutes = adminPageEntries
  .map((entry) => entry.route)
  .filter((route) => !route.includes("["))
  .sort();

function internalAdminReferences(source) {
  const references = [];
  const literalPattern = /(["'`])(\/admin[^"'`?#]*)\1/g;
  let match;

  while ((match = literalPattern.exec(source))) {
    if (!match[2].includes("${")) {
      references.push(match[2]);
    }
  }

  return [...new Set(references)];
}

function usesGuardedSharedShell(source) {
  return sharedShellNavigationGuards.some((guard) => {
    if (!source.includes(`<${guard.component}`)) return false;

    return guard.requiredFragments.every((fragment) =>
      guard.source.includes(fragment),
    );
  });
}

function scenario(name, run) {
  scenarios.push({ name, run });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

scenario("admin command center price radar forms use pending-aware submits", () => {
  assert(
    adminPageSource.includes('import AdminSubmitButton from "./AdminSubmitButton";'),
    "Expected admin command center to import the shared admin submit button.",
  );
  assert(
    (adminPageSource.match(/<AdminSubmitButton/g) || []).length >= 2,
    "Expected price adjustment and ignore forms to use pending-aware submits.",
  );

  for (const label of ["Applying...", "Ignoring..."]) {
    assert(
      adminPageSource.includes(label),
      `Expected admin command center pending label ${label}.`,
    );
  }

  for (const fragment of [
    "Hide this price radar alert for ${labelText} without changing the product price or inventory status.",
    "Hides the alert only; the product record stays unchanged.",
  ]) {
    assert(
      adminPageSource.includes(fragment),
      `Expected admin command center price-radar action-scope fragment ${fragment}.`,
    );
  }
});

scenario("inventory bridge and manual product submits explain scope", () => {
  for (const fragment of [
    "Backfill Inventory Bridge",
    "Backfill missing inventory bridge records from existing product data without publishing or changing live listings.",
    "Repairs local inventory bridge records only; buyer-facing products and eBay listings are not published.",
  ]) {
    assert(
      adminInventoryPageSource.includes(fragment),
      `Expected inventory bridge action-scope fragment ${fragment}.`,
    );
  }

  for (const fragment of [
    "Add manual product",
    "Create one manual store product from the form fields without publishing it to eBay.",
    "Adds the product to TCOS inventory only; marketplace publishing remains a separate admin step.",
  ]) {
    assert(
      adminNewProductPageSource.includes(fragment),
      `Expected manual product action-scope fragment ${fragment}.`,
    );
  }
});

scenario("category review page does not show false-clear import queues", () => {
  for (const fragment of [
    "function safeErrorMessage",
    "const categoryReviewUnavailable = Boolean(error)",
    "Category review source unavailable",
    "Imported category attributes did not load",
    "whether low-confidence category mappings exist",
    "review queue as clear",
    "Diagnostic: {safeErrorMessage(error)}",
    'value={categoryReviewUnavailable ? "Unavailable" : String(rows.length)}',
    'categoryReviewUnavailable ? "Unavailable" : String(reviewRows.length)',
    'categoryReviewUnavailable ? "Unavailable" : String(cleanRows.length)',
    "Category review queue unavailable.",
    "table cannot prove whether imported category mappings",
  ]) {
    assert(
      adminCategoryReviewPageSource.includes(fragment),
      `Expected category review unavailable-state fragment ${fragment}.`,
    );
  }

  assert(
    !adminCategoryReviewPageSource.includes("{error.message}"),
    "Expected category review page to avoid rendering raw database errors.",
  );
  assert(
    adminCategoryReviewPageSource.indexOf("Category review queue unavailable.") <
      adminCategoryReviewPageSource.indexOf(
        "No imported category attributes found yet.",
      ),
    "Expected category review load failures to render before the empty import state.",
  );
});

scenario("admin error recovery keeps a retry action and safe navigation", () => {
  for (const fragment of [
    "unstable_retry()",
    "Retry This Panel",
    "Admin Command Center",
    "Production Smoke",
    "function adminErrorReference",
    "Safe recovery reference",
    "Raw exception details stay in the server/browser logs.",
    "without exposing raw exception text in the operator UI",
  ]) {
    assert(
      adminErrorSource.includes(fragment),
      `Expected admin error recovery fragment ${fragment}.`,
    );
  }

  for (const fragment of [
    "{error.digest || error.message",
    "No digest returned",
  ]) {
    assert(
      !adminErrorSource.includes(fragment),
      `Expected admin error recovery to avoid raw error fallback ${fragment}.`,
    );
  }
});

scenario("admin command center exposes no-dead-end operator action map", () => {
  for (const fragment of [
    "Operator action map",
    "No dead-end action paths",
    "scan cleanup, product control, offer decisions, and paid",
    "Remove bad scan rows, merge selected quantities, retry OCR",
    "bulk saves, sold/end-early policy checks, quantity review",
    "Accept, counter, or decline offers",
    "Review holds, dry-run tracking references, evidence errors",
    "Open InstaComp™ Direct",
    "Open Products",
    "Open Offers",
    "Open Orders",
  ]) {
    assert(
      adminPageSource.includes(fragment),
      `Expected admin action map fragment ${fragment}.`,
    );
  }
});

scenario("admin command center exposes first-screen operator attention strip", () => {
  for (const fragment of [
    "type AttentionPanelRow",
    "adminAttentionRows",
    "Operator attention strip",
    "What needs eyes before anything else",
    "Live admin counts turned into direct routes",
    "ACTION REQUIRED",
    "WATCHLIST",
    "ALL CLEAR",
    "Critical order cases need eyes",
    "Paid orders are ready to ship",
    "Buyer offers need decisions",
    "InstaComp™ found price gaps",
    "Money or evidence needs cleanup",
    "Seller payouts need onboarding",
    "Purchased lots need receiving",
    "Launch gate has blockers",
    "<AttentionPanelCard",
    "Open workbench →",
  ]) {
    assert(
      adminPageSource.includes(fragment),
      `Expected admin attention strip fragment ${fragment}.`,
    );
  }
});

scenario("admin command center surfaces data-source health before counts", () => {
  for (const fragment of [
    "type AdminDataHealthIssue",
    "function adminDataIssue",
    "adminDataHealthIssues",
    "adminDataHealthStatus",
    "Admin data health",
    "Do not trust empty counts yet",
    "Dashboard data sources loaded cleanly",
    "a broken query does not look like an all-clear queue",
    "Open affected workbench →",
    "Open Production Smoke →",
    "Dashboard data source failed",
    "Dashboard data sources healthy",
    "Admin dashboard data sources loaded cleanly",
  ]) {
    assert(
      adminPageSource.includes(fragment),
      `Expected admin data-health fragment ${fragment}.`,
    );
  }
});

scenario("admin command center keeps critical operator routes one click away", () => {
  for (const route of [
    "/admin/instacomp-direct",
    "/admin/products",
    "/admin/products/new",
    "/admin/orders",
    "/admin/offers",
    "/admin/ebay/inventory-intake",
    "/admin/ebay/duplicates",
    "/admin/financial-reconciliation",
    "/admin/market-intel",
    "/admin/production-smoke",
    "/admin/live-payment-launch",
    "/admin/live-shipping-launch",
    "/admin/settings",
    "/admin/security",
    "/admin/accounts",
    "/admin/ebay",
    "/admin/ebay/import-runner",
    "/admin/ebay/publish",
    "/admin/ebay/sync-control",
    "/admin/files",
    "/admin/instacomp",
    "/admin/inventory",
    "/admin/inventory/category-review",
    "/admin/launch-gate-drill",
    "/admin/launch-readiness",
    "/admin/market-intel/readiness",
    "/admin/market-intel/watchlist",
    "/admin/market-intel/comps",
    "/admin/market-intel/discovery",
    "/admin/market-intel/ebay",
    "/admin/market-intel/deals",
    "/admin/market-intel/growth-specs",
    "/admin/market-intel/growth-specs/prospects",
    "/admin/market-intel/buy",
    "/admin/market-intel/portfolio",
    "/admin/market-intel/purchases",
    "/admin/market-intel/purchases/ebay-intake",
    "/admin/market-intel/ingestion",
    "/admin/market-intel/reports",
    "/admin/market-intel/delivery",
    "/admin/market-intel/delivery/test",
    "/admin/order-review-cases",
    "/admin/payment-simulations",
    "/admin/seller-payouts",
    "/admin/shipping",
    "/admin/shipping/simulations",
  ]) {
    assert(
      adminPageSource.includes(`"${route}"`) ||
        adminPageSource.includes(`\`${route}`),
      `Expected admin command center to expose route ${route}.`,
    );
  }
});

scenario("admin runtime smoke covers critical operator routes", () => {
  for (const route of [
    "/admin/login",
    "/admin",
    "/admin/instacomp-direct",
    "/admin/products",
    "/admin/products/new",
    "/admin/orders",
    "/admin/offers",
    "/admin/ebay/inventory-intake",
    "/admin/ebay/duplicates",
    "/admin/financial-reconciliation",
    "/admin/market-intel",
    "/admin/production-smoke",
    "/admin/live-payment-launch",
    "/admin/live-shipping-launch",
    "/admin/settings",
    "/admin/security",
    "/admin/accounts",
    "/admin/ebay",
    "/admin/ebay/import-runner",
    "/admin/ebay/publish",
    "/admin/ebay/sync-control",
    "/admin/files",
    "/admin/instacomp",
    "/admin/inventory",
    "/admin/inventory/category-review",
    "/admin/launch-gate-drill",
    "/admin/launch-readiness",
    "/admin/market-intel/readiness",
    "/admin/market-intel/watchlist",
    "/admin/market-intel/comps",
    "/admin/market-intel/discovery",
    "/admin/market-intel/ebay",
    "/admin/market-intel/deals",
    "/admin/market-intel/growth-specs",
    "/admin/market-intel/growth-specs/prospects",
    "/admin/market-intel/buy",
    "/admin/market-intel/portfolio",
    "/admin/market-intel/purchases",
    "/admin/market-intel/purchases/ebay-intake",
    "/admin/market-intel/ingestion",
    "/admin/market-intel/reports",
    "/admin/market-intel/delivery",
    "/admin/market-intel/delivery/test",
    "/admin/order-review-cases",
    "/admin/payment-simulations",
    "/admin/seller-payouts",
    "/admin/shipping",
    "/admin/shipping/simulations",
  ]) {
    assert(
      adminRuntimeSmokeSource.includes(`path: "${route}"`),
      `Expected admin runtime smoke to cover route ${route}.`,
    );
  }

  for (const fragment of [
    "const authBoundaryChecks = [",
    "unauthenticated admin page redirects to login",
    "/admin/login?next=%2Fadmin%2Fproducts",
    "unauthenticated admin API returns JSON 401",
    "/api/admin/ebay-duplicates",
    "expected JSON response",
    "missing no-store cache header",
    "async function smokeAuthBoundary(check)",
    "const authenticatedApiChecks = [",
    "async function smokeAuthenticatedApi(check, cookieHeader)",
    "/api/admin/ebay-inventory-intake",
    "/api/admin/launch-readiness",
    "/api/admin/launch-gate-drill",
    "/api/admin/live-payment-launch",
    "/api/admin/live-shipping-launch",
    "/api/admin/shipping/provider-setup",
    "Local admin smoke login expected HTTP 303",
    "Local admin smoke login did not return an admin session cookie.",
    "unexpected redirect to",
    "rendered error fragment",
    "response.status !== 200",
    "Admin runtime smoke",
  ]) {
    assert(
      adminRuntimeSmokeSource.includes(fragment),
      `Expected admin runtime smoke guard fragment ${fragment}.`,
    );
  }
});

scenario("admin static page inventory stays linked and runtime-smoked", () => {
  assert(
    staticAdminPageRoutes.length >= 40,
    `Expected a substantial static admin page inventory, found ${staticAdminPageRoutes.length}.`,
  );

  for (const route of staticAdminPageRoutes) {
    assert(
      adminRuntimeSmokeSource.includes(`path: "${route}"`),
      `Expected admin runtime smoke to cover static page route ${route}.`,
    );

    if (adminDashboardLinkExemptions.has(route)) continue;

    assert(
      adminPageSource.includes(`"${route}"`) ||
        adminPageSource.includes(`\`${route}`),
      `Expected admin command center to link static page route ${route}.`,
    );
  }
});

scenario("admin page shells do not strand operators", () => {
  for (const entry of adminPageEntries) {
    if (adminNoDeadEndExemptions.has(entry.route)) continue;

    const references = internalAdminReferences(entry.source);
    const hasDirectAdminNavigation = references.some(
      (reference) => reference !== entry.route,
    );

    assert(
      hasDirectAdminNavigation || usesGuardedSharedShell(entry.source),
      `Expected ${entry.route} to expose admin navigation directly or use a guarded shared admin shell.`,
    );
  }
});

scenario("admin command center uses professional playbook copy", () => {
  assert(
    adminPageSource.includes("Purpose-built workbenches with clear ownership"),
    "Expected admin playbook headline to use professional operator copy.",
  );
  assert(
    adminPageSource.includes(
      "operators can move quickly without confusing scan, inventory",
    ),
    "Expected admin playbook detail to explain the operator workflow clearly.",
  );
  assert(
    !adminPageSource.includes("Big buttons") &&
      !adminPageSource.includes("gray brick") &&
      !adminPageSource.includes("Stop bugging me") &&
      !adminPageSource.includes("No pricing fires") &&
      !adminPageSource.includes("This is the first stop") &&
      !adminPageSource.toLowerCase().includes("bullshit"),
    "Expected admin command center to avoid rough operator copy.",
  );
});

scenario("admin accounts page keeps partial linked-data failures operator-readable", () => {
  for (const fragment of [
    "type AccountDataIssue",
    "function safeErrorMessage",
    "const orderStatsUnavailable = Boolean(ordersResult.error)",
    "const offerStatsUnavailable = Boolean(offersResult.error)",
    "Account profiles loaded, but linked activity is partially unavailable.",
    "Unavailable linked counts are labeled below instead of shown as a",
    "Order links not loaded",
    "Offer links not loaded",
    'value={orderStatsUnavailable ? "Unavailable" : money(linkedRevenue)}',
  ]) {
    assert(
      adminAccountsPageSource.includes(fragment),
      `Expected account partial-load fragment ${fragment}.`,
    );
  }

  assert(
    !adminAccountsPageSource.includes("throw ordersResult.error") &&
      !adminAccountsPageSource.includes("throw offersResult.error"),
    "Expected account linked-data failures to render inline instead of crashing the page.",
  );
});

scenario("admin files page does not show false-empty evidence queues", () => {
  for (const fragment of [
    "const evidenceUnavailable = Boolean(evidenceResult.error)",
    "const casePacketsUnavailable = Boolean(casePacketResult.error)",
    "const fileDataUnavailable = evidenceUnavailable || casePacketsUnavailable",
    "Evidence packet list unavailable",
    "Case packet list unavailable",
    "prove whether evidence packets exist",
    "prove whether case packets exist",
    "One or more evidence sources did not load",
    "safeErrorMessage(evidenceResult.error)",
    "safeErrorMessage(casePacketResult.error)",
  ]) {
    assert(
      adminFilesPageSource.includes(fragment),
      `Expected admin files unavailable-state fragment ${fragment}.`,
    );
  }

  assert(
    adminFilesPageSource.indexOf("Evidence packet list unavailable") <
      adminFilesPageSource.indexOf("No evidence packets yet"),
    "Expected evidence load failures to render before the empty evidence state.",
  );
  assert(
    adminFilesPageSource.indexOf("Case packet list unavailable") <
      adminFilesPageSource.indexOf("No saved case packets yet"),
    "Expected case packet load failures to render before the empty case-packet state.",
  );
});

scenario("admin orders page keeps fulfillment failures operator-readable", () => {
  for (const fragment of [
    "function safeErrorMessage",
    "const orderLoadErrorMessage = safeErrorMessage(error)",
    "Fulfillment queues unavailable",
    "Order storage did not load, so this page cannot prove whether",
    "Queue counts",
    "Unavailable",
    "do not ship from stale",
    "let accountProfilesError",
    "try {",
    "accountProfiles = await getAccountProfilesByIds",
    "const accountProfilesUnavailable = Boolean(accountProfilesError)",
    "Linked account profiles unavailable",
    'role="status"',
    "Orders loaded, but buyer account enrichment did not",
    "Linked account profile lookup unavailable",
    "accountProfilesUnavailable={accountProfilesUnavailable}",
  ]) {
    assert(
      adminOrdersPageSource.includes(fragment),
      `Expected admin orders failure-recovery fragment ${fragment}.`,
    );
  }

  assert(
    adminOrdersPageSource.indexOf("Fulfillment queues unavailable") <
      adminOrdersPageSource.indexOf("Retry orders or open the dashboard"),
    "Expected orders load failures to explain queue uncertainty before recovery actions.",
  );
  assert(
    !adminOrdersPageSource.includes("{error.message}"),
    "Expected orders page to avoid rendering raw database error messages.",
  );
});

scenario("instacomp direct route owns its segment config", () => {
  assert(
    instaCompDirectSource.includes('export const dynamic = "force-dynamic";'),
    "Expected InstaComp Direct route to own its dynamic segment config.",
  );
  assert(
    !instaCompDirectSource.includes("export { default, dynamic }"),
    "Expected InstaComp Direct route not to re-export dynamic segment config.",
  );
  assert(
    instaCompDirectSource.includes(
      "Scan, correct, remove, retry, merge quantities, price",
    ),
    "Expected InstaComp Direct page to advertise the fixed remove/retry workflow.",
  );
});

scenario("admin route checker blocks re-exported segment config", () => {
  for (const fragment of [
    "routeSegmentConfigNames",
    "extractSegmentConfigReexports",
    "Admin route segment config check failed",
    "re-exports route segment config",
    "export config directly from the route segment file instead",
  ]) {
    assert(
      adminRouteCheckSource.includes(fragment),
      `Expected admin route checker segment-config guard fragment ${fragment}.`,
    );
  }
});

scenario("admin control checker blocks dead href placeholders", () => {
  for (const fragment of [
    "deadHrefLiteralPattern",
    "deadHrefExpressionPattern",
    "Admin links must not use href=\\\"#\\\" placeholders",
    "Admin links must not fall back to href=\\\"#\\\"",
    "render disabled/unavailable state instead",
  ]) {
    assert(
      adminControlCheckSource.includes(fragment),
      `Expected admin control checker to guard dead href placeholder fragment ${fragment}.`,
    );
  }
});

scenario("admin control checker requires scoped submit titles", () => {
  for (const fragment of [
    "adminSubmitButtonPattern",
    "<AdminSubmitButton",
    "AdminSubmitButton must include a title that explains the action scope and side effects.",
    "Disabled AdminSubmitButton must include disabledReason so blocked clicks explain what to fix.",
    "disabledReason",
  ]) {
    assert(
      adminControlCheckSource.includes(fragment),
      `Expected admin control checker to guard submit-title fragment ${fragment}.`,
    );
  }
});

scenario("instacomp operator shell explains no-dead-end row actions", () => {
  for (const fragment of [
    "No-dead-end controls",
    "Wrong scan cleanup",
    "Mark → remove",
    "Remove Wrong Row",
    "Duplicate quantity merge",
    "2 + 1 = 3",
    "Merge Selected Qty",
    "Active scan control",
    "End / remove",
    "Command Center",
    "Duplicate Finder",
    "Smoke Checks",
  ]) {
    assert(
      instaCompFrameSource.includes(fragment),
      `Expected InstaComp operator shell fragment ${fragment}.`,
    );
  }
});

const failed = [];

for (const item of scenarios) {
  try {
    item.run();
    console.log(`✓ ${item.name}`);
  } catch (error) {
    failed.push({ name: item.name, error });
    console.error(`✗ ${item.name}`);
    console.error(error);
  }
}

console.log(
  `Admin dashboard action simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`,
);

if (failed.length > 0) {
  process.exitCode = 1;
}
