#!/usr/bin/env node
import fs from 'node:fs';

const path = 'src/app/api/account/seller/instacomp-scan/intake/route.ts';
const source = fs.readFileSync(path, 'utf8');
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
if (!source.includes('status: "draft"')) throw new Error('Pending Listing must remain draft-only.');
if (source.includes('status: "active"')) throw new Error('UUID handoff must not activate inventory.');
console.log('PASS InstaComp permanent card UUID upload → Pending Listing handoff');
