import { readFileSync } from "node:fs";

const intake = readFileSync("src/app/api/account/seller/instacomp-scan/intake/route.ts", "utf8");
const pricing = readFileSync("src/app/api/account/seller/instacomp-scan/price/route.ts", "utf8");
const page = readFileSync("src/app/seller/instacomp-scan/page.tsx", "utf8");
const receipt = readFileSync("src/lib/instacomp-registry-receipt.ts", "utf8");

function requireText(source, value, message) {
  if (!source.includes(value)) throw new Error(message);
}

// OBBFB is the new intake contract. The legacy seller/registry route remains
// available for historical imports, but does not govern new physical scans.
const directIntake = readFileSync("src/app/api/kingmaker/obbfb-intake/route.ts", "utf8");
const directRules = readFileSync("src/lib/obbfb-intake-rules.ts", "utf8");
const directLock = readFileSync("src/app/api/kingmaker/obbfb-lock/route.ts", "utf8");
const directPublish = readFileSync("src/lib/obbfb-publication-guard.ts", "utf8");
const directUi = readFileSync("src/app/kingmaker/OBBFBOperatorForm.tsx", "utf8");
const alias = readFileSync("src/app/api/kingmaker/instacomp-scan-intake-v2/route.ts", "utf8");
if (alias.includes("obbfbPost")) {
  for (const [source, expected, label] of [
    [directIntake, "archiveInstaCompAiLocalSupervisedScan", "Durable physical front/back archival"],
    [directIntake, "identifyOBBFBVision", "Direct multimodal first-time visual identification"],
    [directIntake, "findMacDuplicateByImagePair", "Physical image-pair duplicates"],
    [directIntake, "createMacKingmakerDraft", "No-publish Mac-local Pending inventory"],
    [directIntake, "researchOBBFBComps", "Verified 365-day sold comp search"],
    [directPublish, "sellerPriceOverride", "Seller price lock"],
    [directRules, "formatDirectTitle", "Print-run-only title"],
    [directRules, "serialFull", "Complete serial in description"],
    [directRules, "select365DayComps", "365-day raw median pricing"],
    [directLock, "manualIdentityLocked: true", "Human owner identity lock"],
    [directLock, "sellerPriceOverride: true", "Manual owner price lock"],
    [directPublish, "finalPublicationBlockers", "Never auto-publish without physical readiness"],
    [directUi, "SAVE & LOCK", "Seller review and confirmation"],
  ]) {
    requireText(source, expected, "OBBFB scanner certification missing: " + label);
  }
  if (directIntake.includes("runKingmakerMacScan(")) {
    throw new Error("OBBFB new scans must not invoke legacy Checklist Registry pipeline.");
  }
  console.log("OBBFB direct image intake, verified comps and owner publish firewall certified.");
  process.exit(0);
}


function requireOrder(source, first, second, message) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex) throw new Error(message);
}

const pricingInvocation = "const pricingResponse = await runVerifiedPricing";
requireText(intake, "analyzeWithInstaCompAiLocal", "Scanner must call the Mac mini evidence service.");
requireText(intake, "registryFingerprint", "Scanner must require a Registry fingerprint.");
requireText(intake, "DUPLICATE_SCAN", "Scanner must block duplicate image-pair scans.");
requireText(
  intake,
  "findMacDuplicateByImagePair(imagePairSha256",
  "Duplicate detection must use the immutable image-pair hash through indexed Mac-local inventory.",
);
requireText(intake, "checklistIdentity", "Scanner must persist the canonical Registry receipt.");
requireText(intake, "registryIdentityId", "Scanner receipt must persist Registry identity ID.");
requireText(intake, "registryFingerprintSha256", "Scanner receipt must persist Registry fingerprint.");
requireText(intake, "lockedFields: fields", "Scanner receipt must persist canonical locked fields.");
requireText(intake, "status: \"draft\"", "Scanner must create Pending Listings drafts, never publish directly.");
requireText(intake, pricingInvocation, "Scanner must invoke the verified pricing route.");
requireOrder(
  intake,
  "const scan = await analyzeWithInstaCompAiLocal",
  "findMacDuplicateByImagePair(imagePairSha256",
  "Registry analysis must happen before Mac-local duplicate/inventory handling.",
);
requireOrder(intake, "const registryFingerprint", pricingInvocation, "Registry fingerprint must be required before comps run.");
requireOrder(
  intake,
  "const inserted = await createMacKingmakerDraft",
  pricingInvocation,
  "Mac-local Pending item must exist before verified pricing is invoked.",
);

for (const field of ["year", "manufacturer", "cardNumber", "player"]) {
  requireText(intake, `fields.${field}`, `Scanner must require canonical ${field}.`);
  requireText(receipt, `\"${field}\"`, `Publish firewall must continue requiring ${field}.`);
}

requireText(page, 'capture="environment"', "Scanner UI must support mobile camera capture.");
requireText(page, "Identify + price card", "Scanner UI must expose the complete action.");
requireText(page, 'href="/kingmaker/pending"', "Scanner UI must hand off to KINGMAKER Pending Listings.");
requireText(page, 'label: "+5%"', "Scanner UI must offer the +5% price choice.");
requireText(page, 'label: "+10%"', "Scanner UI must offer the +10% price choice.");
requireText(page, "/api/account/seller/instacomp-scan/price", "Scanner UI must persist selected pricing.");
requireText(pricing, "listingPriceSource", "Chosen price source must be auditable.");
requireText(pricing, "pricingChosenAt", "Chosen price must receive a timestamp receipt.");

console.log("InstaComp scanner-to-pending contract certified.");
