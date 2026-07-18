import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const adminRoot = path.join(repoRoot, "src/app/admin");

const adminPageSource = await readFile(
  new URL("../src/app/admin/page.tsx", import.meta.url),
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

const staticAdminPageRoutes = (
  await walkFiles(adminRoot, (filePath) => filePath.endsWith(`${path.sep}page.tsx`))
)
  .map(adminRouteFromPageFile)
  .filter((route) => !route.includes("["))
  .sort();

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

scenario("admin command center uses professional playbook copy", () => {
  assert(
    adminPageSource.includes("Big buttons, clear jobs, no maze-like workflows"),
    "Expected admin playbook headline to use professional operator copy.",
  );
  assert(
    !adminPageSource.toLowerCase().includes("bullshit"),
    "Expected admin command center to avoid rough operator copy.",
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
