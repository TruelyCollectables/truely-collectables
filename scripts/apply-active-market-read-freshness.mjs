import fs from "node:fs";

const routeFile =
  "src/app/api/account/seller/inventory/active-pricing/route.ts";
let route = fs.readFileSync(routeFile, "utf8");
const freshnessImport =
  'import { quarantineActiveMarketTrackingForRead } from "../../../../../../lib/active-market-read-freshness";';
if (!route.includes(freshnessImport)) {
  const anchor =
    'import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";';
  if (!route.includes(anchor)) {
    throw new Error("Could not find active-pricing import anchor.");
  }
  route = route.replace(anchor, `${freshnessImport}\n${anchor}`);
}

const oldHelper = `function currentTracking(metadata: Record<string, unknown> | null) {
  const root = recordValue(recordValue(metadata).instacomp_tracking);
  const current = recordValue(root.current);
  return Object.keys(current).length > 0 ? current : null;
}`;
const newHelper = `function currentTracking(metadata: Record<string, unknown> | null) {
  const root = recordValue(recordValue(metadata).instacomp_tracking);
  const current = recordValue(root.current);
  if (!Object.keys(current).length) return null;
  return quarantineActiveMarketTrackingForRead({
    metadata,
    tracking: current,
  }).tracking;
}`;
if (!route.includes(newHelper)) {
  if (!route.includes(oldHelper)) {
    throw new Error("Could not find active-pricing currentTracking helper.");
  }
  route = route.replace(oldHelper, newHelper);
}
fs.writeFileSync(routeFile, route);

const uiFile = "src/app/seller/inventory/SellerActiveInventoryPricing.tsx";
let ui = fs.readFileSync(uiFile, "utf8");
const labels = `    active_market_refresh_required:
      "Refresh required — saved market evidence is stale",
    active_market_scan_running: "Active Market scan running",
    active_market_scan_failed: "Last Active Market scan failed",
    active_market_source_coverage_blocked:
      "Active Market source coverage blocked",
    active_market_evidence_accounting_blocked:
      "Active Market evidence accounting blocked",
    active_market_integrity_blocked: "Active Market integrity blocked",
`;
if (!ui.includes('active_market_refresh_required:')) {
  const anchor = '    active_market_no_results: "No active-market results",\n';
  if (!ui.includes(anchor)) {
    throw new Error("Could not find Seller Inventory evidence-mode label anchor.");
  }
  ui = ui.replace(anchor, `${anchor}${labels}`);
}
fs.writeFileSync(uiFile, ui);

console.log("Active Market read freshness quarantine applied.");
