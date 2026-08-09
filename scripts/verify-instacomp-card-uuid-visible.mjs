#!/usr/bin/env node
import fs from 'node:fs';

const api = fs.readFileSync('src/app/api/account/seller/instacomp-pending/route.ts', 'utf8');
const page = fs.readFileSync('src/app/seller/instacomp-pending/page.tsx', 'utf8');

for (const [source, marker, label] of [
  [api, 'legacy_product_id,card_uuid,seller_account_id', 'Pending API selects first-class UUID'],
  [api, 'cardUuid: textValue(row.card_uuid) || textValue(instaComp.cardUuid)', 'Pending API UUID fallback'],
  [page, 'cardUuid: string | null;', 'Pending page UUID type'],
  [page, 'Permanent Card UUID', 'visible UUID label'],
  [page, 'item.instaComp.cardUuid || "UUID missing — listing blocked"', 'visible UUID value'],
  [page, 'select-all break-all font-mono', 'copyable UUID presentation'],
  [page, 'scan events may change, this number does not', 'permanent UUID explanation'],
]) {
  if (!source.includes(marker)) throw new Error(`Missing ${label}: ${marker}`);
}
console.log('PASS Permanent Card UUID is returned and visibly rendered in Pending Listings');
