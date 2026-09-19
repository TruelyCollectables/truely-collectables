import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}
function requireText(source, needle, label) {
  if (!source.includes(needle)) throw new Error(`${label}: missing ${needle}`);
}
function forbidText(source, needle, label) {
  if (source.includes(needle)) throw new Error(`${label}: forbidden ${needle}`);
}

const panel = read("src/app/kingmaker/receiving/ManualPurchasePanel.tsx");
const receiving = read("src/app/kingmaker/receiving/ReceivingClient.tsx");
const api = read("src/app/api/account/seller/instacomp-manual-purchase/route.ts");
const evidenceApi = read("src/app/api/account/seller/instacomp-manual-purchase/evidence/route.ts");
const identifyApi = read("src/app/api/account/seller/instacomp-manual-purchase/identify/route.ts");
const pairing = read("src/lib/manual-purchase-photo-pairing.ts");
const mac = read("services/instacomp-ai/app/kingmaker_manual_purchases.py");
const accounting = read("services/instacomp-ai/app/kingmaker_accounting.py");
const enhancer = read("src/app/seller/inventory/SellerInventoryExactCardEnhancer.tsx");

requireText(receiving, "<ManualPurchasePanel onSaved={load} />", "Receiving");
requireText(panel, "Add Card Manually / Add Purchase Lot", "Manual purchase UI");
requireText(panel, "Upload multiple card photos", "Lot card upload");
requireText(panel, "Confirm Purchase Lot", "Lot confirmation");
requireText(panel, "bookkeeping allocations only", "Allocation warning");
requireText(panel, "card_photo", "Per-card evidence");
requireText(panel, "Purchase URL matched to the purchase/lot only.", "Lot URL isolation");
forbidText(panel, "Identity filled from the eBay item URL.", "Lot URL must not become card identity");
forbidText(panel, "Card 1 was filled automatically.", "Lot URL must not populate Card 1");
requireText(identifyApi, "analyzeWithInstaCompAiLocal", "Manual purchase internal identification");
requireText(identifyApi, "mac_local_instacomp", "Manual purchase internal identification source");
forbidText(identifyApi, "api.openai.com", "Manual purchase identification must not use paid OpenAI fallback");
forbidText(identifyApi, "OPENAI_API_KEY", "Manual purchase identification must not depend on OpenAI credits");
requireText(pairing, "i += 2", "Ordered front/back pairing");
requireText(pairing, "files: back ? [front.file, back.file] : [front.file]", "Two images must remain one card");
requireText(api, "/manual-purchase-draft", "Manual purchase API");
requireText(api, "/manual-purchase-confirm", "Manual purchase API");
requireText(evidenceApi, "/manual-purchase-evidence", "Evidence API");
forbidText(api, "supabase", "Manual purchase API must stay Mac-local");
forbidText(evidenceApi, "supabase", "Evidence API must stay Mac-local");
requireText(mac, "manual_purchase_lots", "Mac manual purchase schema");
requireText(mac, "manual_purchase_audit_log", "Mac audit schema");
requireText(mac, "purchase_learning_facts", "Learning facts");
requireText(mac, "lot_equal_split", "Lot allocation");
requireText(mac, "training_eligible = bool(evidence_hashes) and bool(exact_cost)", "Training guard");
requireText(accounting, "COALESCE(manual_entry,0)=0 OR COALESCE(individual_cost_verified,0)=1", "Deal Hunter exact-cost guard");
requireText(accounting, "attach_manual_purchase_to_existing_inventory", "Existing inventory manual link");
requireText(enhancer, "Add / Edit Purchase Cost", "Inventory purchase editor link");

console.log("PASS kingmaker manual purchase regressions");
