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
  metadata: metadata("Sonia Citron", "122", "Base", "Ice"),
  pendingTitle: "2025 Panini Prizm #122 Sonia Citron RC Ice Prizm",
  product: { id: 510440, title: "2025 Prizm Orange Ice Prizm Sonia Citron Washington Mystics Orange Ice #122 RC", player: "Sonia Citron" },
}).status, "mismatch");

assert.equal(classifyWebsiteProductIdentity({
  metadata: { instacomp: { checklistIdentity: { lockedFields: { year: "2025", manufacturer: "Panini", brand: "Prizm", player: "Kiki Iriafen", cardNumber: "149", setName: "Base", parallel: "Ice", variation: "Rookie Variation" } } } },
  pendingTitle: "2025 Panini Prizm #149 Kiki Iriafen RC Ice Prizm Rookie Variation",
  product: { id: 510279, title: "2025 Prizm Ice Prizm Kiki Iriafen Chicago Sky #149 RC", player: "Kiki Iriafen" },
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
assert(pendingClient.includes("Merge Selected → Existing Exact Listing"), "Pending UI must expose the exact-card merge action in the seller workflow.");
assert(pendingClient.includes("Merge +1 · Website Qty · Keep eBay/Mercari 1"), "Each exact current-inventory card must expose an obvious one-copy merge action.");
assert(pendingClient.includes("Merge +1 · Website + Existing eBay Qty · Mercari 1"), "Seller must be able to increase the existing eBay listing quantity without creating a duplicate.");
assert(reconcileRoute.includes("leave_existing_listing_unchanged"), "Exact-card merge must leave an active Mercari listing quantity unchanged.");
assert(reconcileRoute.includes("mark_eligible_to_relist"), "Exact-card merge must mark sold/ended Mercari inventory eligible to relist.");
assert(reconcileRoute.includes("increase_existing_listing_quantity"), "Exact-card merge must support increasing the existing eBay listing quantity.");
assert(reconcileRoute.includes("leave_existing_listing_quantity_unchanged"), "Exact-card merge must support keeping eBay quantity unchanged/reserve.");
assert(reconcileRoute.includes('status: "channels_applied"'), "Exact-card merge must persist channel completion before final merge completion.");
assert(reconcileRoute.includes("absoluteEbayTarget = wholeQuantity(ebayPlan.targetQuantity)"), "eBay retries must use one persisted absolute target.");
assert(reconcileRoute.includes("newQuantity: absoluteEbayTarget"), "Existing eBay listing updates must set the persisted absolute target, not increment blindly on retry.");
assert(reconcileRoute.includes("ebay_existing_quantity_update_failed"), "A failed eBay quantity update must leave the source retryable instead of completing the merge.");
assert(!reconcileRoute.includes("const nextEbayQuantity = currentEbay.quantity + addedQuantity"), "Post-merge eBay updates must not recompute a fresh +1 target on retry.");
assert(
  reconcileRoute.indexOf('status: "channels_applied"') <
    reconcileRoute.lastIndexOf('status: "completed"'),
  "Channel state must be durable before the merge can be marked completed.",
);
assert(reconcileRoute.includes("duplicateListingAllowed: false"), "Exact-card merge must never silently create a duplicate eBay listing.");
assert(reconcileRoute.includes("exact_registry_identity_required"), "Exact-card merge must require a trusted exact Registry identity.");
assert(reconcileRoute.includes("pricePreserved"), "Exact-card merge must record that the existing selling price was preserved.");
assert(reconcileRoute.includes("exactMergeHistory"), "Exact-card merge must persist an auditable merge receipt.");
assert(reconcileRoute.includes('status: "prepared"'), "Website reconciliation must record a prepared absolute target before mutating quantity.");
assert(reconcileRoute.includes('status: "completed"'), "Website reconciliation must record completion for idempotent retries.");
assert(reconcileRoute.includes("multiple_exact_live_products"), "Website reconciliation must block ambiguous multiple exact live products.");
assert(reconcileRoute.includes("unique_physical_asset"), "Website reconciliation must block serial/graded unique assets.");
console.log("PASS KINGMAKER current website inventory regressions");
