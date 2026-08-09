#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    source = path.read_text(encoding="utf-8")
    if new in source:
        print(f"already patched {label}: {path}")
        return
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one source block in {path}, found {count}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")
    print(f"patched {label}: {path}")


types = ROOT / "src/modules/inventory/types.ts"
repo = ROOT / "src/modules/inventory/repository.ts"
engine = ROOT / "src/modules/inventory/engine.ts"
checkout = ROOT / "src/lib/checkout-order-finalization.ts"

# Types: one permanent physical-card UUID follows the inventory object.
replace_once(types, '''  legacy_product_id: number | null;\n  sku: string | null;\n''', '''  legacy_product_id: number | null;\n  card_uuid: string | null;\n  sku: string | null;\n''', "InventoryItem.card_uuid")
replace_once(types, '''export type LegacyProductSnapshot = {\n  id: number;\n  seller_account_id: string | null;\n''', '''export type LegacyProductSnapshot = {\n  id: number;\n  seller_account_id: string | null;\n  card_uuid: string | null;\n''', "LegacyProductSnapshot.card_uuid")
replace_once(types, '''export type UniversalInventoryItem = {\n  inventoryItemId: string | null;\n  legacyProductId: number;\n''', '''export type UniversalInventoryItem = {\n  inventoryItemId: string | null;\n  legacyProductId: number;\n  cardUuid: string | null;\n''', "UniversalInventoryItem.cardUuid")
replace_once(types, '''export type CreateInventoryItemInput = {\n  seller_account_id?: string | null;\n  legacy_product_id?: number | null;\n''', '''export type CreateInventoryItemInput = {\n  seller_account_id?: string | null;\n  legacy_product_id?: number | null;\n  card_uuid?: string | null;\n''', "CreateInventoryItemInput.card_uuid")

# Repository: explicit card_uuid create/upsert persistence.
replace_once(repo, '''        legacy_product_id: input.legacy_product_id ?? null,\n        sku: input.sku ?? null,\n''', '''        legacy_product_id: input.legacy_product_id ?? null,\n        card_uuid: input.card_uuid ?? null,\n        sku: input.sku ?? null,\n''', "repository.create card_uuid")
replace_once(repo, '''      legacy_product_id: input.legacy_product_id ?? null,\n      sku: input.sku,\n''', '''      legacy_product_id: input.legacy_product_id ?? null,\n      card_uuid: input.card_uuid ?? existing?.card_uuid ?? null,\n      sku: input.sku,\n''', "repository.upsert card_uuid")

# Inventory engine helpers and mapping.
replace_once(engine, '''type SellerDraftProductInput = {\n  sellerAccountId: string | null;\n  title: string;\n''', '''type SellerDraftProductInput = {\n  sellerAccountId: string | null;\n  cardUuid?: string | null;\n  title: string;\n''', "seller draft cardUuid input")
replace_once(engine, '''function toNumber(value: unknown): number {\n  const parsed = Number(value ?? 0);\n  return Number.isFinite(parsed) ? parsed : 0;\n}\n''', '''function toNumber(value: unknown): number {\n  const parsed = Number(value ?? 0);\n  return Number.isFinite(parsed) ? parsed : 0;\n}\n\nfunction validCardUuid(value: unknown) {\n  const normalized = String(value || "").trim().toLowerCase();\n  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)\n    ? normalized\n    : null;\n}\n\nfunction metadataCardUuid(metadata: Record<string, unknown> | null | undefined) {\n  const record = metadata && typeof metadata === "object" ? metadata : {};\n  const instaComp =\n    record.instacomp && typeof record.instacomp === "object" && !Array.isArray(record.instacomp)\n      ? (record.instacomp as Record<string, unknown>)\n      : {};\n  return validCardUuid(instaComp.cardUuid);\n}\n''', "card UUID mapping helpers")
replace_once(engine, '''    id: Number(product.id),\n    seller_account_id: product.seller_account_id ?? null,\n    sku: product.sku ?? null,\n''', '''    id: Number(product.id),\n    seller_account_id: product.seller_account_id ?? null,\n    card_uuid: validCardUuid(product.card_uuid),\n    sku: product.sku ?? null,\n''', "legacy product card_uuid mapping")
replace_once(engine, '''  if (inventoryItem) {\n    const authenticity = extractAuthenticityProfile(inventoryItem.metadata);\n\n    return {\n      inventoryItemId: inventoryItem.id,\n      legacyProductId: product.id,\n''', '''  if (inventoryItem) {\n    const authenticity = extractAuthenticityProfile(inventoryItem.metadata);\n    const cardUuid =\n      validCardUuid(inventoryItem.card_uuid) ??\n      metadataCardUuid(inventoryItem.metadata) ??\n      validCardUuid(product.card_uuid);\n\n    return {\n      inventoryItemId: inventoryItem.id,\n      legacyProductId: product.id,\n      cardUuid,\n''', "universal inventory cardUuid")
replace_once(engine, '''  return {\n    inventoryItemId: null,\n    legacyProductId: product.id,\n    sellerAccountId: product.seller_account_id ?? null,\n''', '''  return {\n    inventoryItemId: null,\n    legacyProductId: product.id,\n    cardUuid: validCardUuid(product.card_uuid),\n    sellerAccountId: product.seller_account_id ?? null,\n''', "product-only universal cardUuid")
replace_once(engine, '''        const payload = {\n          seller_account_id: product.seller_account_id ?? null,\n          legacy_product_id: product.id,\n          sku: product.sku,\n''', '''        const payload = {\n          seller_account_id: product.seller_account_id ?? null,\n          legacy_product_id: product.id,\n          card_uuid: product.card_uuid,\n          sku: product.sku,\n''', "backfill product card_uuid")
replace_once(engine, '''      .insert({\n        store_id: this.storeId,\n        seller_account_id: input.sellerAccountId,\n        sku,\n''', '''      .insert({\n        store_id: this.storeId,\n        seller_account_id: input.sellerAccountId,\n        card_uuid: validCardUuid(input.cardUuid),\n        sku,\n''', "seller draft product card_uuid")
replace_once(engine, '''    const inventoryItem = await this.repository.create({\n      seller_account_id: input.sellerAccountId,\n      legacy_product_id: legacyProduct.id,\n      sku: legacyProduct.sku,\n''', '''    const inventoryItem = await this.repository.create({\n      seller_account_id: input.sellerAccountId,\n      legacy_product_id: legacyProduct.id,\n      card_uuid: validCardUuid(input.cardUuid) ?? legacyProduct.card_uuid,\n      sku: legacyProduct.sku,\n''', "seller draft inventory card_uuid")
replace_once(engine, '''      .update({\n        title: input.title,\n        player: input.player,\n''', '''      .update({\n        card_uuid: current.cardUuid,\n        title: input.title,\n        player: input.player,\n''', "product update preserves card_uuid")
replace_once(engine, '''      {\n        title: input.title,\n        description,\n        category: input.sport ?? "sports cards",\n''', '''      {\n        card_uuid: current.cardUuid,\n        title: input.title,\n        description,\n        category: input.sport ?? "sports cards",\n''', "inventory update preserves card_uuid")

# Checkout: immutable order snapshot carries the exact physical card UUID.
replace_once(checkout, '''        product_id: product.legacyProductId,\n        seller_account_id: product.sellerAccountId,\n        title: product.title,\n''', '''        product_id: product.legacyProductId,\n        card_uuid: product.cardUuid,\n        seller_account_id: product.sellerAccountId,\n        title: product.title,\n''', "order item card_uuid snapshot")
replace_once(checkout, '''    .select("id,product_id,seller_account_id,title,price,quantity")\n''', '''    .select("id,product_id,card_uuid,seller_account_id,title,price,quantity")\n''', "order item ledger card_uuid")

print("Permanent physical card UUID lifecycle patch complete.")
