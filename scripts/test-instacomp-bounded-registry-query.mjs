import { readFileSync } from "node:fs";

const source = readFileSync("src/lib/instacomp-checklist-first-server.ts", "utf8");

const required = [
  "loadRegistryRowsBounded",
  '.select(\n      "id,release_id,version_id,set_id,card_number,normalized_card_number,variation,autograph_status,memorabilia_status"',
  '.from("checklist_card_players")',
  '.from("checklist_card_teams")',
  '.from("checklist_card_identities")',
  "const loaded = await loadRegistryRowsBounded(supabase, cardNumber, input);",
];

for (const marker of required) {
  if (!source.includes(marker)) {
    throw new Error(`Missing bounded Registry marker: ${marker}`);
  }
}

const oldExplodingQuery = 'version:checklist_versions!inner(id,is_active,status)';
const resolverBody = source.slice(source.indexOf("export async function resolveInstaCompChecklistFirstFromRegistry"));
if (resolverBody.includes(oldExplodingQuery)) {
  throw new Error("Resolver still contains the old multiplicative nested Registry query");
}

console.log("bounded Registry query contract: PASS");
