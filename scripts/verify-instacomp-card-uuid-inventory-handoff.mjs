#!/usr/bin/env node
import fs from 'node:fs';

const path = 'src/app/api/account/seller/instacomp-scan/intake/route.ts';
const source = fs.readFileSync(path, 'utf8');
const activation = fs.readFileSync('src/lib/inventory-activation.ts', 'utf8');
const required = [
  ['physical card UUID validation', 'function physicalCardUuid(scan: InstaCompAiLocalScan)'],
  ['missing-column rollout guard', 'function isMissingCardUuidColumn(error: unknown)'],
  ['fail closed without UUID', 'code: "PHYSICAL_CARD_UUID_REQUIRED"'],
  ['inventory metadata UUID', 'cardUuid,\n        scanId: scan.scan_id'],
  ['first-class inventory UUID', '.insert({ ...inventoryInsert, card_uuid: cardUuid })'],
  ['schema rollout fallback', 'if (insertError && isMissingCardUuidColumn(insertError))'],
  ['upload response UUID', 'success: true,\n        cardUuid,\n        inventoryItemId: inserted.id'],
];
for (const [label, marker] of required) {
  if (!source.includes(marker)) throw new Error(`Missing ${label}: ${marker}`);
}

const inventoryInsertBlock =
  source.split('const inventoryInsert = {', 2)[1]?.split('};', 1)[0] || '';
if (!inventoryInsertBlock) throw new Error('Inventory insert block was not found.');
if (!inventoryInsertBlock.includes('status: "draft"')) {
  throw new Error('Pending Listing UUID handoff must create a draft.');
}
if (inventoryInsertBlock.includes('status: "active"')) {
  throw new Error('UUID handoff inventory insert must never activate inventory.');
}

for (const marker of [
  '| "missing_card_uuid"',
  'const hasPermanentCardUuid = validPhysicalCardUuid(instaComp.cardUuid);',
  'if (requiresFrontBackListing && !hasPermanentCardUuid)',
  'blockers.push("missing_card_uuid")',
]) {
  if (!activation.includes(marker)) {
    throw new Error(`Missing permanent-card activation firewall: ${marker}`);
  }
}

console.log('PASS InstaComp permanent card UUID upload → Pending Listing → activation firewall');
