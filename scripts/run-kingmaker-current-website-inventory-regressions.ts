import assert from "node:assert/strict";
import fs from "node:fs";
import { classifyWebsiteProductIdentity } from "../src/lib/instacomp-current-website-inventory";

function metadata(player: string, cardNumber: string, setName: string, parallel: string) {
  return { instacomp: { checklistIdentity: { lockedFields: { year: "2025", manufacturer: "Panini", player, cardNumber, setName, parallel } } } };
}

assert.equal(classifyWebsiteProductIdentity({
  metadata: metadata("Sonia Citron", "122", "Base", "Green"),
  pendingTitle: "2025 Panini Prizm #122 Sonia Citron RC Green Prizm",
  product: { id: 502337, title: "2025 Panini Prizm WNBA #122 Sonia Citron Base Green Prizm RC", player: "Sonia Citron" },
}).status, "exact");

assert.equal(classifyWebsiteProductIdentity({
  metadata: metadata("Sonia Citron", "122", "Base", "Blue Velocity"),
  pendingTitle: "2025 Panini Prizm #122 Sonia Citron RC Blue Velocity Prizm",
  product: { id: 502335, title: "2025 Panini Prizm WNBA #122 Sonia Citron Base Blue Cracked Ice RC", player: "Sonia Citron" },
}).status, "mismatch");

assert.equal(classifyWebsiteProductIdentity({
  metadata: metadata("Hailey Van Lith", "139", "Base", "Ice"),
  pendingTitle: "2025 Panini Prizm #139 Hailey Van Lith RC Ice Prizm",
  product: { id: 502408, title: "2025 Panini Prizm WNBA #139 Hailey Van Lith Base Silver Prizm RC", player: "Hailey Van Lith" },
}).status, "mismatch");

assert.equal(classifyWebsiteProductIdentity({
  metadata: metadata("Saniya Rivers", "132", "Base Set - Premier Level", "Base Set - Premier Level - Silver"),
  pendingTitle: "2025 Select Premier Level #132 Saniya Rivers RC Silver",
  product: { id: 502358, title: "2025 Panini Select WNBA #132 Saniya Rivers Premier Level Base RC", player: "Saniya Rivers" },
}).status, "mismatch");

assert.equal(classifyWebsiteProductIdentity({
  metadata: metadata("Saniya Rivers", "92", "Rated Rookies", "Holo"),
  pendingTitle: "2025 Donruss Rated Rookies #92 Saniya Rivers RC HOLO",
  product: { id: 502389, title: "2025 Panini Donruss WNBA #92 Saniya Rivers Rated Rookie Base RC", player: "Saniya Rivers" },
}).status, "mismatch");

assert.equal(classifyWebsiteProductIdentity({
  metadata: metadata("Aaliyah Nye", "235", "Base Set - Courtside", "Base"),
  pendingTitle: "2025 Select Courtside #235 Aaliyah Nye RC",
  product: { id: 502346, title: "2025 Panini Select WNBA #235 Aaliyah Nye Courtside Base RC", player: "Aaliyah Nye" },
}).status, "exact");

assert.equal(classifyWebsiteProductIdentity({
  metadata: metadata("Sonia Citron", "7", "En Fuego", "White Disco"),
  pendingTitle: "2025 Select En Fuego #7 Sonia Citron RC White Disco /75",
  product: { id: 502490, title: "2025 Panini Select WNBA #7 Sonia Citron En Fuego Orange Disco Prizm RC /75", player: "Sonia Citron" },
}).status, "mismatch");


assert.equal(classifyWebsiteProductIdentity({
  metadata: { instacomp: { manualIdentityLocked: true, manualIdentity: { year: "2025", manufacturer: "Panini", player: "Sonia Citron", cardNumber: "13", setName: "Kaleidoscopic", subset: "Base", parallel: "Base" } } },
  pendingTitle: "2025 Panini Prizm Kaleidoscopic #13 Sonia Citron RC",
  product: { id: 510456, title: "2025 Prizm Groovy Sonia Citron Washington Mystics Base #13", player: "Sonia Citron" },
}).status, "mismatch");

assert.equal(classifyWebsiteProductIdentity({
  metadata: { instacomp: { manualIdentityLocked: true, manualIdentity: { year: "2025", manufacturer: "Panini", player: "Sonia Citron", cardNumber: "13", setName: "Groovy", subset: "Base", parallel: "Base" } } },
  pendingTitle: "2025 Panini Prizm Groovy #13 Sonia Citron RC",
  product: { id: 510456, title: "2025 Prizm Groovy Sonia Citron Washington Mystics Base #13", player: "Sonia Citron" },
}).status, "exact");

const pendingRoute = fs.readFileSync("src/app/api/account/seller/instacomp-pending/route.ts", "utf8");
const channelRoute = fs.readFileSync("src/app/api/account/seller/instacomp-pending/channel/route.ts", "utf8");
const pendingClient = fs.readFileSync("src/app/kingmaker/pending/PendingClient.tsx", "utf8");
const reconcileRoute = fs.readFileSync("src/app/api/account/seller/instacomp-pending/reconcile-website/route.ts", "utf8");
assert(pendingRoute.includes("liveWebsiteProductsByAnchor"), "Pending API must scan sellable website products independently of inventory_items.status.");
assert(pendingRoute.includes("websiteInventory:"), "Pending API must expose current website inventory evidence.");
assert(channelRoute.includes("WEBSITE_LINK_IDENTITY_MISMATCH"), "Website publishing must fail closed on a mismatched live product link.");
assert(pendingClient.includes("CURRENT WEBSITE INVENTORY"), "Pending UI must visibly flag current website inventory.");
assert(pendingClient.includes("WEBSITE LINK MISMATCH · DO NOT PUBLISH"), "Pending UI must visibly block mismatched website links.");
assert(reconcileRoute.includes('.select("quantity")'), "Website reconciliation must re-read current product quantity before each unprepared merge.");
assert(reconcileRoute.includes("legacy_product_id: null"), "Merged archived sources must release the canonical website product linkage.");
assert(reconcileRoute.includes("sourceLegacyProductId"), "Reconciliation must retain the source placeholder product ID in metadata for safe cleanup and retry.");
assert(reconcileRoute.includes('status: "quantity_applied"'), "Reconciliation must mark quantity application before source finalization.");
assert(reconcileRoute.includes("liveProductQuantity >= preparedTarget"), "Prepared retries must preserve a later/higher live quantity instead of writing a stale target.");
assert(reconcileRoute.includes('.eq("quantity", liveProductQuantity)'), "Product quantity updates must use optimistic concurrency protection.");
assert(reconcileRoute.includes("prepared_quantity_changed_downward"), "Prepared retries must fail closed if quantity moved downward before application can be proven.");
assert(pendingClient.includes("Merge Exact Current Website Inventory"), "Pending UI must expose the exact-current-inventory merge action.");
assert(reconcileRoute.includes('status: "prepared"'), "Website reconciliation must record a prepared absolute target before mutating quantity.");
assert(reconcileRoute.includes('status: "completed"'), "Website reconciliation must record completion for idempotent retries.");
assert(reconcileRoute.includes("multiple_exact_live_products"), "Website reconciliation must block ambiguous multiple exact live products.");
assert(reconcileRoute.includes("unique_physical_asset"), "Website reconciliation must block serial/graded unique assets.");
console.log("PASS KINGMAKER current website inventory regressions");
