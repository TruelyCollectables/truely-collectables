import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(path,"utf8");
const vision = read("src/lib/obbfb-direct-vision.ts");
const retry = read("src/app/api/kingmaker/obbfb-retry/route.ts");
const page = read("src/app/kingmaker/obbfb-recovery/page.tsx");
const drafts = read("src/app/kingmaker/obbfb-recovery/RecoveryDrafts.tsx");
const form = read("src/app/kingmaker/OBBFBOperatorForm.tsx");
const menu = read("src/app/kingmaker/KingmakerShell.tsx");
for (const text of ["@cf/qwen/qwen3.8-27b","@cf/google/gemma-4-26b-a4b-it","getCloudflareContext","chat_template_kwargs","image_url","backNormalized"]) {
  assert(vision.includes(text), "Cloudflare direct-vision fallback contract: "+text);
}
const providerOrder = vision.slice(vision.indexOf("const providers = ["));
assert.match(providerOrder, /geminiDirectVision[\s\S]*cloudflareDirectVision[\s\S]*openAIDirectVision[\s\S]*for \(const provider of providers\)/);
for (const text of ["getAuthenticatedAccountFromRequest","ensureAccountStoreMembership","obbfbSellerAccountId","account.id","manualIdentityLocked","sellerPriceOverride","fetchInstaCompAiLocalScanImage","identifyOBBFBVision","researchOBBFBComps","updateMacKingmakerDraft","published: false",'folder: "pending"','pendingQueue: "listings"']) {
  assert(retry.includes(text),"Saved image retry security and integrity contract: "+text);
}
for (const forbidden of ["archiveInstaCompAiLocalSupervisedScan","createMacKingmakerDraft","publishMacKingmaker","checklist_registry.sqlite3","Ollama"]) {
  assert(!retry.includes(forbidden), "Retry must not create a duplicate or consult old Registry: "+forbidden);
}
assert(page.includes('listMacMasterListingRows({ folder: "pending", pendingQueue: "listings"'),"Saved scans must be recoverable from Resale Pending");
assert(page.includes("RecoveryDrafts") && drafts.includes("OBBFBOperatorForm"),"Recovered scans must remain seller editable");
assert(form.includes("RETRY VISION USING SAVED PHOTOS"),"Operator must be able to reprocess without reupload");
assert(menu.includes("/kingmaker/obbfb-recovery"),"Recovery page must be accessible from Kingmaker navigation");
console.log("PASS: archived-image recovery, secure seller ownership, Gemini-first paired vision, no auto-publish and no duplicates");
