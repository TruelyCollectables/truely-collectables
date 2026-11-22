import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { obbfbPublicationBlockers } from "../src/lib/obbfb-publication-guard";
import {
  buildDirectDescription, finalPublicationBlockers, formatDirectTitle,
  identitySufficient, normalizeDirectIdentity, printRun, sameCardVariant,
  select365DayComps, type VerifiedSale,
} from "../src/lib/obbfb-intake-rules";

const base = {
  year: "2024-25", brandSet: "Panini Prizm Basketball",
  manufacturer: "Panini", player: "Jane Doe", cardNumber: "94",
  parallel: "Silver Prizm", subset: null,
  serialNumber: "09/99", isRookie: true, isAutograph: false, isRelic: false,
  inscription: null, notes: null, confidence: 0.95,
};
const identity = normalizeDirectIdentity(base);
const title = formatDirectTitle(identity);
const description = buildDirectDescription(identity);
assert(title.length < 80, "Title must be <80 chars");
assert(title.includes("Silver Prizm"), "Keep precise Prizm parallel suffix");
assert(title.includes("/99"), "Title must contain print run");
assert(!title.includes("09/99"), "Title must never use full serial stamp");
assert(!title.includes("Base"), "Remove Base token");
assert(formatDirectTitle(normalizeDirectIdentity({...base, parallel: "Silver"})).includes("Silver Prizm"), "Keep Prizm suffix on color finishes even when visually abbreviated");
assert(!title.includes("Basketball Basketball"), "No repeated adjacent words");
assert(!formatDirectTitle(normalizeDirectIdentity({ ...base, brandSet: "2024-25 Panini Prizm" })).includes("2024-25 2024-25"), "Never duplicate release year in title");
assert(description.includes("09/99"), "Description includes full serial");
assert.equal(printRun("09/99"), "/99");
assert.equal(printRun("3/25"), "/25");
assert.equal(printRun("2024/25"), null, "Full serial parser must reject impossible print-run copy");
assert.equal(normalizeDirectIdentity({ ...base, isAutograph: true, autographEvidence: null }).isAutograph, false, "Never assume an autograph");
assert.equal(normalizeDirectIdentity({ ...base, isAutograph: true, autographEvidence: "Visible blue ink signature on card front" }).isAutograph, true);
assert.equal(normalizeDirectIdentity({ ...base, isRelic: true, relicEvidence: "Visible game-used jersey swatch" }).isRelic, true);
assert.equal(identitySufficient(identity), true);
assert.deepEqual(finalPublicationBlockers(identity, title, description, "/front", "/back"), []);
assert(finalPublicationBlockers(identity, title, description, "/front", "/front").includes("distinct_front_back_required"));
assert(finalPublicationBlockers(identity, title, description.replace("09/99", "XX/YY"), "/front", "/back").includes("full_serial_missing_from_description"));
const differentCopy = normalizeDirectIdentity({ ...base, serialNumber: "13/99" });
assert.equal(sameCardVariant(identity, differentCopy), true, "Other copy of same /99 variant can reuse verified sale");
assert.equal(sameCardVariant(identity, normalizeDirectIdentity({ ...base, serialNumber: "13/25" })), false, "Different print run is a different parallel");
assert.equal(sameCardVariant(identity, normalizeDirectIdentity({ ...base, parallel: "Gold Prizm" })), false);
const now = new Date("2026-11-21T22:00:00Z");
const sale = (price: number, date="2026-11-15T00:00:00Z", serial=price.toString()): VerifiedSale => ({
  price, soldAt: date, title: "2024-25 Panini Prizm Jane Doe Silver Prizm #94 /99",
  url: "https://www.ebay.com/itm/" + (317000000000 + Math.floor(price * 10) + Number(serial) || 1),
  source: "ebay_realized", verified: true, realized: true,
});
const priced = select365DayComps([sale(12), sale(16), sale(20)], identity, now);
assert.equal(priced.medianComp, 18);
assert.equal(priced.suggestedPrice, 22.99, "floor(comp*1.25)+.99");
assert.equal(priced.accepted.length, 2, "Numbered cards below 75% of the max must be excluded");
const breaker = select365DayComps([sale(1.25), sale(2.50), sale(3.50)], normalizeDirectIdentity({ ...base, serialNumber: null }), now);
assert.equal(breaker.accepted.length, 2, "Breaker dumps excluded when higher sales exist");
assert.equal(breaker.suggestedPrice, 3.99);
const noComps = select365DayComps([sale(20, "2025-11-01T00:00:00Z")], identity, now);
assert.equal(noComps.status, "0 Comps — Seller Price Required");
assert.equal(noComps.suggestedPrice, null);
const low = select365DayComps([sale(1)], normalizeDirectIdentity({ ...base, serialNumber: null }), now);
assert.equal(low.suggestedPrice, 2.99);
const unverified = select365DayComps([{...sale(100), verified: false}], identity, now);
assert.equal(unverified.suggestedPrice, null, "Never synthesize or price unverified sales");
assert.equal(select365DayComps([{...sale(100), realized: false}], identity, now).suggestedPrice, null, "Do not price asking prices");
const relic = select365DayComps([sale(5), sale(8), sale(12)], normalizeDirectIdentity({...base,serialNumber:null,isRelic:true,relicEvidence:"Visible jersey patch"}), now);
assert.equal(relic.accepted.length, 2);
const longTitle = formatDirectTitle(normalizeDirectIdentity({...base,brandSet:"An Extremely Long Championship Special Edition National Treasures Treasures Collector Premium Extra-Long Set Name",player:"Jane Alexandria Doe-Smith Junior The Third",parallel:"Purple Refractor Prizm",serialNumber:"04/99"}));
assert(longTitle.length < 80,"Longest title must be shortened");
assert(longTitle.includes("/99"),"Never drop the print-run during truncation");
assert(!longTitle.includes("04/99"),"Never print the copy number");
const sellerMetadata = {
  instacomp: {
    intakeEngine: "obbfb_direct_vision_v1", manualIdentityLocked: true,
    sellerPriceOverride: true, humanVerified: true, manualListingTitleLocked: true,
    manualIdentity: identity, manualListingTitle: title, listingPrice: 22.99,
    pricingCheckedAt: now.toISOString(),
  },
  seller_review: { identity_confirmed: true },
  listingWorkflow: { queue: "pending_listings" },
};
const publication = { metadata: sellerMetadata, title, description, price: 22.99, front: "/front", back: "/back" };
assert.deepEqual(obbfbPublicationBlockers(publication), [], "Verified OBBFB can pass explicit publish gate");
assert(obbfbPublicationBlockers({ ...publication, metadata: { ...sellerMetadata, instacomp: {...sellerMetadata.instacomp, manualIdentityLocked: false}} }).includes("seller_physical_identity_and_price_lock_required"));
assert.deepEqual(obbfbPublicationBlockers({
  ...publication, price: 1, metadata: {
    ...sellerMetadata, instacomp: { ...sellerMetadata.instacomp, listingPrice: 1 },
  },
}), [], "A seller-locked dollar price passes the explicit publish gate");
assert(obbfbPublicationBlockers({ ...publication, price: 2.99 }).includes("operator_price_lock_mismatch"));
assert(obbfbPublicationBlockers({ ...publication, metadata: {...sellerMetadata, listingWorkflow: {queue: "need_to_merge"}} }).includes("need_to_merge_must_be_resolved"));
assert(obbfbPublicationBlockers({ ...publication, title: "2024 Jane Doe #94 09/99" }).includes("copy_serial_forbidden_in_title"));
assert(obbfbPublicationBlockers({ ...publication, back: "/front" }).includes("distinct_front_back_required"));
const ownerRoute = readFileSync("src/app/api/kingmaker/obbfb-lock/route.ts", "utf8");
const intakeRoute = readFileSync("src/app/api/kingmaker/obbfb-intake/route.ts", "utf8");
assert(ownerRoute.includes("metadata.obbfbSellerAccountId"), "Owner lock must use the persisted draft creator ID");
assert(intakeRoute.includes("obbfbSellerAccountId: account.id"), "Draft intake must persist owner ID in metadata");
const marketAdapter = readFileSync("services/instacomp-ai/app/obbfb_market_comp_routes.py", "utf8");
assert(marketAdapter.includes('prefix="/v1/obbfb-market-comp"'));
assert(marketAdapter.includes("_search_130point"));
assert(marketAdapter.includes("_search_fanatics"));
console.log("OBBFB rules PASS: title/serial, autograph, verified 365-day comps, +25%/.99, 0 comps, owner locks and publish blockers.");
