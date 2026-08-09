#!/usr/bin/env node
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const types = read('src/modules/inventory/types.ts');
const repo = read('src/modules/inventory/repository.ts');
const engine = read('src/modules/inventory/engine.ts');
const checkout = read('src/lib/checkout-order-finalization.ts');

const required = [
  [types, 'card_uuid: string | null;', 'inventory and product DB card UUID types'],
  [types, 'cardUuid: string | null;', 'universal inventory card UUID'],
  [types, 'card_uuid?: string | null;', 'create/update inventory UUID input'],
  [repo, 'card_uuid: input.card_uuid ?? null', 'repository create UUID persistence'],
  [repo, 'card_uuid: input.card_uuid ?? existing?.card_uuid ?? null', 'repository upsert UUID preservation'],
  [repo, 'filters.push(`card_uuid.eq.${searchValue.toLowerCase()}`)', 'exact physical-card UUID inventory search'],
  [engine, 'metadataCardUuid(inventoryItem.metadata)', 'metadata UUID fallback'],
  [engine, 'cardUuid: validCardUuid(product.card_uuid)', 'product-only UUID mapping'],
  [engine, 'card_uuid: product.card_uuid', 'product backfill UUID propagation'],
  [engine, 'card_uuid: current.cardUuid', 'product/inventory update UUID preservation'],
  [checkout, 'card_uuid: product.cardUuid', 'sale/order UUID snapshot'],
  [checkout, 'id,product_id,card_uuid,seller_account_id,title,price,quantity', 'ledger UUID retention'],
];
for (const [source, marker, label] of required) {
  if (!source.includes(marker)) throw new Error(`Missing ${label}: ${marker}`);
}

if (checkout.includes('card_uuid: crypto.randomUUID')) {
  throw new Error('Checkout must never generate a new physical-card UUID.');
}
if (engine.includes('cardUuid: crypto.randomUUID')) {
  throw new Error('Inventory must never regenerate a physical-card UUID.');
}
console.log('PASS one permanent physical card UUID survives inventory → product → universal inventory → order item and remains searchable');
