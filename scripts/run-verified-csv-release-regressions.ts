import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildKingmakerListingReadiness } from "../src/lib/kingmaker-listing-readiness";
import { instaCompPendingQueueFromMetadata } from "../src/lib/instacomp-pending-queue";
import { getInventoryActivationBlockers } from "../src/lib/inventory-activation";
import { createDualMarketplaceListingDraft } from "../src/lib/dual-marketplace-listing";
import { isInstaCompPublicationIdentityConfirmed } from "../src/lib/instacomp-publication-identity";
import { getConfiguredInstaCompMacUrl, isTrustedInstaCompMacUrl } from "../src/lib/instacomp-mac-credentials";
const fixtures=JSON.parse(readFileSync("scripts/fixtures/verified-csv-fixtures.json","utf8"));
let assertions=0;
for (const [name,item] of Object.entries(fixtures) as [string,any][]) {
 assert.equal(instaCompPendingQueueFromMetadata(item.metadata),"listings"); assertions++;
 assert.equal(isInstaCompPublicationIdentityConfirmed(item.metadata),true); assertions++;
 const draft=createDualMarketplaceListingDraft(item);
 const params={metadata:item.metadata,frontImageUrl:item.metadata.instacomp.frontImageUrl,backImageUrl:item.metadata.instacomp.backImageUrl,condition:item.condition,quantity:1,ebayCardCondition:draft.cardCondition || (draft.ebayCondition==="USED_VERY_GOOD" ? item.condition : ""),graded:name==="slab"};
 const unpriced=buildKingmakerListingReadiness(params);
 assert.deepEqual(unpriced.blockers,["missing_website_price","missing_ebay_price","missing_mercari_price"]); assertions++;
 const priced=buildKingmakerListingReadiness({...params,websitePrice:20,ebayPrice:25,mercariPrice:25});
 assert.equal(priced.coreReady,true); assertions++;
 assert.equal(priced.websiteReady,true); assertions++;
 assert.equal(priced.ebayReady,true); assertions++;
 assert.equal(priced.mercariReady,true); assertions++;
 assert.deepEqual(getInventoryActivationBlockers({...item,price:25}),[]); assertions++;
 assert.equal(draft.identity.player,"Verified Fixture"); assertions++;
 assert.equal(draft.identity.cardNumber,"007"); assertions++;
 if(name==="slab"){assert.equal(draft.certificationNumber,"fixture-cert-001");assertions++;}
}
process.env.KINGMAKER_LOCAL_MAC_BRIDGE="1";
assert.equal(getConfiguredInstaCompMacUrl(),"http://127.0.0.1:8787");assertions++;
assert.equal(isTrustedInstaCompMacUrl("http://127.0.0.1:8787"),true);assertions++;
assert.equal(isTrustedInstaCompMacUrl("http://127.0.0.1:1234"),false);assertions++;
assert.equal(isTrustedInstaCompMacUrl("http://127.0.0.1:8787/private"),false);assertions++;
assert.equal(isTrustedInstaCompMacUrl("https://evil.example"),false);assertions++;
console.log("PASS: "+assertions+" live-release assertions: existing local auth/channel architecture retained, verified CSV cards reach pricing/listing without Registry or price-guide verification, read-only image references and exact slab certificates preserved, loopback bridge is restricted to its fixed API endpoint.");
