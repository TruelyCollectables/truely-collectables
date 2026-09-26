import assert from "node:assert/strict";
import fs from "node:fs";

const routePath = "src/app/api/account/seller/inventory/instacomp-card-edit/route.ts";
const route = fs.readFileSync(routePath, "utf8");

const lookupStart = route.indexOf('let query = supabase');
const lookupEnd = route.indexOf('query = isOwner', lookupStart);
assert.ok(lookupStart >= 0 && lookupEnd > lookupStart, "card edit lookup query must exist");
const lookup = route.slice(lookupStart, lookupEnd);
assert.equal(
  lookup.includes('.eq("status", "draft")'),
  false,
  "Master Listings edit lookup must not be restricted to draft rows",
);

assert.ok(
  route.includes('if (item.status === "archived" || item.status === "sold")'),
  "Archived/sold inventory must remain protected from editing",
);
assert.ok(
  route.includes('.neq("status", "archived")') && route.includes('.neq("status", "sold")'),
  "Save must reject a row that becomes archived/sold during the edit",
);
assert.ok(
  route.includes('.select("id,status")') && route.includes('.maybeSingle()'),
  "Save must prove the inventory row was actually updated",
);
assert.equal(
  route.includes('{ error: "Pending card was not found." }'),
  false,
  "Master Listings edit failures must not claim every editable row is Pending",
);

const pendingPath = "src/app/api/account/seller/instacomp-pending/route.ts";
const pending = fs.readFileSync(pendingPath, "utf8");
const clientPath = "src/app/kingmaker/pending/PendingClient.tsx";
const client = fs.readFileSync(clientPath, "utf8");

assert.ok(
  route.includes("manualListingTitle: displayTitle") &&
    route.includes("manualListingTitleLocked: true") &&
    route.includes("manualListingTitleSavedAt: editedAt") &&
    route.includes("manualListingTitleSavedBy: account.id"),
  "Seller-saved listing title must be persisted as an explicit locked presentation override",
);
assert.ok(
  route.includes("if (!identityEdited)") && route.includes("identityUnchanged: true"),
  "Title/details-only saves must bypass manual identity learning/correction",
);
assert.ok(
  route.includes("const title = listingTitle(body.title, 300)") &&
    route.includes("!displayTitle.trim()"),
  "The API must validate title content without trimming the seller persisted bytes",
);

const manualTitleIndex = pending.indexOf("manualListingTitle ||");
const generatedTitleIndex = pending.indexOf("generatedTitle ||", manualTitleIndex);
assert.ok(
  manualTitleIndex >= 0 && generatedTitleIndex > manualTitleIndex,
  "Pending displayTitle must prefer an explicitly locked seller title over a regenerated title",
);
assert.ok(
  pending.includes("instaComp.manualListingTitleLocked === true") &&
    pending.includes("exactStoredText(instaComp.manualListingTitle)"),
  "Pending must only honor the manual title when the explicit seller lock is present",
);
const displayTitleStart = pending.indexOf("const displayTitle =");
const displayTitleEnd = pending.indexOf("const websiteAnchor =", displayTitleStart);
const displayTitleBlock = pending.slice(displayTitleStart, displayTitleEnd);
const manualTitleDisplayIndex = displayTitleBlock.indexOf("manualListingTitle ||");
const registryExactDisplayIndex = displayTitleBlock.indexOf("registryExactTitle ||");
assert.ok(
  pending.includes("const registryExactTitle = registryIdentityLocked") &&
    pending.includes("buildInstaCompRegistryExactTitle(primaryIdentity)") &&
    manualTitleDisplayIndex >= 0 &&
    registryExactDisplayIndex > manualTitleDisplayIndex,
  "Seller-saved listing title must win presentation while exact Registry identity remains unchanged underneath",
);
assert.ok(
  client.includes("const identityEdited = identityEditChanged(card, edit)") &&
    client.includes("identityEdited,"),
  "The edit UI must tell the API whether checklist identity fields actually changed",
);
assert.ok(
  client.includes("const finalTitle = edit.title.trim() ? edit.title : standardizedTitle(edit)"),
  "The edit UI must preserve a nonblank seller title exactly instead of trimming or rebuilding it",
);


const exactRoutePath = "src/app/api/kingmaker/instacomp-front-back-exact/route.ts";
const exactRoute = fs.readFileSync(exactRoutePath, "utf8");
assert.ok(
  exactRoute.includes("const previousRegistryLockedFields = record(previousChecklistIdentity.lockedFields)") &&
    exactRoute.includes("text(previousRegistryLockedFields.player, 200) ||") &&
    exactRoute.includes("previousChecklistIdentity.registryIdentityId") &&
    exactRoute.includes("previousChecklistIdentity.registryFingerprintSha256"),
  "A locked Registry receipt must drive repeat identity checks ahead of seller/listing title text",
);
assert.ok(
  exactRoute.includes("const stablePairHashesMatch = stableStoredPairHashesMatch") &&
    exactRoute.includes("Object.keys(previousRegistryLockedFields).length > 0") &&
    exactRoute.includes("identityId: previousRegistryIdentityId") &&
    exactRoute.includes("fingerprintSha256: previousRegistryFingerprintSha256") &&
    exactRoute.includes("!stablePairRegistryCandidate &&") &&
    exactRoute.includes("stablePairHashesMatch &&"),
  "Unchanged exact bytes must reuse the stored Registry receipt without requiring the Mac tunnel",
);
assert.ok(
  pending.includes('checklistIdentityStatus === "identified"') &&
    pending.includes("instaComp.identityComplete === true"),
  "Pending must recognize exact-scan identified receipts as authoritative Registry locks",
);
assert.ok(
  pending.includes('.in("status", ["draft", "active"])'),
  "Master Listings must read active inventory as well as draft staging rows",
);
assert.ok(
  pending.includes("legacyWebsiteLinked = false") &&
    pending.includes("legacyWebsiteLinkedProductIds") &&
    pending.includes('row.status === "active"'),
  "Listed Website inventory must classify from durable active inventory/product state",
);
assert.ok(
  pending.includes('textValue(acquisition.source) || "Misc"') &&
    pending.includes('(gradedCard ? null : "Near Mint or Better")'),
  "Safe seller defaults must clear unmatched acquisition and raw eBay condition blockers",
);
const channelRoute = fs.readFileSync(
  "src/app/api/account/seller/instacomp-pending/channel/route.ts",
  "utf8",
);
assert.ok(
  channelRoute.includes('text(storedAcquisition.source, 120) ||') &&
    channelRoute.includes('"Misc"') &&
    channelRoute.includes('(generated.grader ? "" : "Near Mint or Better")'),
  "Publishing must persist the same safe acquisition/condition defaults used by Master Listings",
);
assert.ok(
  client.includes("No exact sold comp produced a price. Enter one Manual Price below"),
  "Pending must explain how the remaining seller-price blocker is cleared",
);

console.log("KINGMAKER Master Listings edit regressions passed.");
