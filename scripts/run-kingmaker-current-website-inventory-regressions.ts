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

const pendingRoute = fs.readFileSync("src/app/api/account/seller/instacomp-pending/route.ts", "utf8");
const channelRoute = fs.readFileSync("src/app/api/account/seller/instacomp-pending/channel/route.ts", "utf8");
const pendingClient = fs.readFileSync("src/app/kingmaker/pending/PendingClient.tsx", "utf8");
assert(pendingRoute.includes("liveWebsiteProductsByAnchor"), "Pending API must scan sellable website products independently of inventory_items.status.");
assert(pendingRoute.includes("websiteInventory:"), "Pending API must expose current website inventory evidence.");
assert(channelRoute.includes("WEBSITE_LINK_IDENTITY_MISMATCH"), "Website publishing must fail closed on a mismatched live product link.");
assert(pendingClient.includes("CURRENT WEBSITE INVENTORY"), "Pending UI must visibly flag current website inventory.");
assert(pendingClient.includes("WEBSITE LINK MISMATCH · DO NOT PUBLISH"), "Pending UI must visibly block mismatched website links.");
console.log("PASS KINGMAKER current website inventory regressions");
