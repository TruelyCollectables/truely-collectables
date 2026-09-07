import fs from "node:fs";

const ui = fs.readFileSync("src/app/kingmaker/pending/PendingClient.tsx", "utf8");
const priceRoute = fs.readFileSync("src/app/api/account/seller/instacomp-scan/price/route.ts", "utf8");
const pendingRoute = fs.readFileSync("src/app/api/account/seller/instacomp-pending/route.ts", "utf8");

const requireText = (haystack, needle, message) => {
  if (!haystack.includes(needle)) throw new Error(message);
};

requireText(ui, "Manual seller price", "KINGMAKER must show a manual seller price control.");
requireText(ui, "Save Manual Price", "KINGMAKER must expose a manual price save action.");
requireText(ui, 'savePrice(card, selectedPrice, "kingmaker_manual")', "Manual price must persist with an explicit seller-manual source.");
requireText(ui, "selectedPrice <= 0", "Manual price must reject zero and negative values.");
requireText(ui, 'sellerManualPrice ? "Seller Manual" : "InstaComp"', "Manual overrides must not be labeled as InstaComp truth.");
if (/max=["']\d/.test(ui.slice(ui.indexOf("Manual seller price"), ui.indexOf("Save Manual Price") + 200))) {
  throw new Error("Manual seller price must not have an arbitrary upper price cap.");
}
requireText(priceRoute, "const applyGroup = body.applyGroup !== false && Boolean(groupKey);", "Manual pricing must preserve exact raw duplicate group pricing.");
requireText(priceRoute, "listingPriceSource: source", "Manual price source must be persisted.");
if (priceRoute.includes("suggestedPrice: selectedPrice") || priceRoute.includes("trustedForPricing: true")) {
  throw new Error("Seller manual price must not become InstaComp pricing truth.");
}
requireText(pendingRoute, "storedEbayPrice || savedListingPrice || suggestedPrice", "Channel pricing must honor saved listing/manual price before the InstaComp suggestion.");
requireText(pendingRoute, '? "seller_manual"', "Channel pricing must identify seller manual overrides explicitly.");
console.log("KINGMAKER manual-price regressions passed.");
