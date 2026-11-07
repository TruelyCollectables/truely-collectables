import fs from 'node:fs';

const path = 'src/lib/instacomp-learning-server.ts';
const source = fs.readFileSync(path, 'utf8');
const start = source.indexOf('export async function resolveChecklistRegistry(');
const end = source.indexOf('\nexport async function findChecklistRegistryMatch', start);
if (start < 0 || end < 0) throw new Error('resolveChecklistRegistry block not found');
const block = source.slice(start, end);

const required = [
  '.from("checklist_versions")',
  '.from("checklist_releases")',
  '.from("checklist_sets")',
  '.from("checklist_cards")',
  '.from("checklist_card_players")',
  '.from("checklist_card_teams")',
  '.from("checklist_card_identities")',
  '.eq("normalized_card_number", cardNumber)',
  '.limit(250)',
  'internal_checklist_card_detail_lookup_failed',
];
for (const token of required) {
  if (!block.includes(token)) throw new Error(`Missing bounded Registry contract: ${token}`);
}

const forbidden = [
  'version:checklist_versions!inner',
  'players:checklist_card_players',
  'teams:checklist_card_teams',
  'identities:checklist_card_identities',
  '.limit(500);',
];
for (const token of forbidden) {
  if (block.includes(token)) throw new Error(`Legacy wide Registry contract still present: ${token}`);
}

const cardLookup = block.slice(
  block.indexOf('const cardResult = await supabase'),
  block.indexOf('if (cardResult.error)'),
);
if (/player:checklist_players|team:checklist_teams|parallel:checklist_parallels/.test(cardLookup)) {
  throw new Error('Exact-card ID lookup still expands nested detail relations');
}

console.log('Production Registry resolver is ID-first and bounded.');
