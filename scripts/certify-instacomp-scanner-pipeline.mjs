import { readFileSync } from "node:fs";

const intake = readFileSync("src/app/api/account/seller/instacomp-scan/intake/route.ts", "utf8");
const pricing = readFileSync("src/app/api/account/seller/instacomp-scan/price/route.ts", "utf8");
const page = readFileSync("src/app/seller/instacomp-scan/page.tsx", "utf8");
const receipt = readFileSync("src/lib/instacomp-registry-receipt.ts", "utf8");

function requireText(source, value, message) {
  if (!source.includes(value)) throw new Error(message);
}

function requireOrder(source, first, second, message) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex) throw new Error(message);
}

requireText(intake, "analyzeWithInstaCompAiLocal", "Scanner must call the Mac mini evidence service.");
requireText(intake, "registryFingerprint", "Scanner must require a Registry fingerprint.");
requireText(intake, "DUPLICATE_SCAN", "Scanner must block duplicate image-pair scans.");
requireText(intake, ".contains(\"metadata\", { instacomp: { imagePairSha256 } })", "Duplicate detection must use the immutable image-pair hash.");
requireText(intake, "checklistIdentity", "Scanner must persist the canonical Registry receipt.");
requireText(intake, "registryIdentityId", "Scanner receipt must persist Registry identity ID.");
requireText(intake, "registryFingerprintSha256", "Scanner receipt must persist Registry fingerprint.");
requireText(intake, "lockedFields: fields", "Scanner receipt must persist canonical locked fields.");
requireText(intake, "status: \"draft\"", "Scanner must create Pending Listings drafts, never publish directly.");
requireText(intake, "runVerifiedPricing", "Scanner must use the verified pricing route.");
requireOrder(intake, "analyzeWithInstaCompAiLocal", ".from(\"inventory_items\")", "Registry analysis must happen before inventory creation.");
requireOrder(intake, "registryFingerprint", "runVerifiedPricing", "Registry fingerprint must be required before comps run.");
requireOrder(intake, ".insert({", "runVerifiedPricing", "Pending item must exist before verified pricing is invoked.");

for (const field of ["year", "manufacturer", "cardNumber", "player"]) {
  requireText(intake, `fields.${field}`, `Scanner must require canonical ${field}.`);
  requireText(receipt, `\"${field}\"`, `Publish firewall must continue requiring ${field}.`);
}

requireText(page, 'capture="environment"', "Scanner UI must support mobile camera capture.");
requireText(page, "Identify + price card", "Scanner UI must expose the complete action.");
requireText(page, 'href="/seller/instacomp-pending"', "Scanner UI must hand off to Pending Listings.");
requireText(page, 'label: "+5%"', "Scanner UI must offer the +5% price choice.");
requireText(page, 'label: "+10%"', "Scanner UI must offer the +10% price choice.");
requireText(page, "/api/account/seller/instacomp-scan/price", "Scanner UI must persist selected pricing.");
requireText(pricing, "listingPriceSource", "Chosen price source must be auditable.");
requireText(pricing, "pricingChosenAt", "Chosen price must receive a timestamp receipt.");

console.log("InstaComp scanner-to-pending contract certified.");
