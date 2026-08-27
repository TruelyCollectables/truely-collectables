#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text("utf-8")
    if new in text:
        print(f"already patched {label}: {path}")
        return
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one anchor in {path}, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"patched {label}: {path}")


pending_api = ROOT / "src/app/api/account/seller/instacomp-pending/route.ts"
replace_once(
    pending_api,
    '''          humanVerified: instaComp.humanVerified === true,\n          serialNumber: textValue(ai.serialNumber) || exactSerialNumber,\n''',
    '''          humanVerified: instaComp.humanVerified === true,\n          cardUuid:\n            textValue(instaComp.cardUuid) ||\n            textValue(ai.internalCardUuid) ||\n            null,\n          identity: {\n            sport: textValue(ai.sport),\n            league: textValue(ai.league),\n            year: textValue(ai.year),\n            manufacturer:\n              textValue(ai.manufacturer) || textValue(ai.brand),\n            brand: textValue(ai.brand),\n            setName: textValue(ai.setName) || textValue(ai.set_name),\n            subset: textValue(ai.subset),\n            player: textValue(ai.player),\n            team: textValue(ai.team),\n            cardNumber: textValue(ai.cardNumber) || textValue(ai.card_number),\n            parallel:\n              textValue(ai.checklistParallel) ||\n              textValue(ai.parallelName) ||\n              textValue(ai.parallel),\n            variation: textValue(ai.variation),\n            serialNumber: textValue(ai.serialNumber) || exactSerialNumber,\n            isRookie: ai.isRookie === true || collectibleAsset.rookie === true,\n            isAuto: ai.isAuto === true || collectibleAsset.autograph === true,\n            isRelic: ai.isRelic === true || collectibleAsset.memorabilia === true,\n            inscription:\n              ai.internalInscription === true || collectibleAsset.inscription === true,\n            inscriptionText:\n              textValue(ai.internalInscriptionText) ||\n              textValue(collectibleAsset.inscription_text),\n            memorabiliaType:\n              textValue(ai.internalMemorabiliaType) ||\n              textValue(collectibleAsset.memorabilia_type),\n          },\n          serialNumber: textValue(ai.serialNumber) || exactSerialNumber,\n''',
    "pending API full identity + card UUID",
)

card_edit = ROOT / "src/app/api/account/seller/inventory/instacomp-card-edit/route.ts"
replace_once(
    card_edit,
    '''    const title = clean(body.title, 300);\n    const exactParallel = clean(body.parallel, 120);\n''',
    '''    const title = clean(body.title, 300);\n    // Structural Base remains identity data only and is suppressed from every\n    // operator/listing title even when a manual correction is submitted.\n    const displayTitle = title\n      .replace(/\\bBase\\b/gi, " ")\n      .replace(/\\s+/g, " ")\n      .trim();\n    const exactParallel = clean(body.parallel, 120);\n''',
    "manual title structural Base suppression",
)
replace_once(
    card_edit,
    '''    if (!inventoryItemId || !title) {\n''',
    '''    if (!inventoryItemId || !displayTitle) {\n''',
    "manual title validation",
)
replace_once(
    card_edit,
    '''      .select("id,seller_account_id,status,metadata")\n''',
    '''      .select("id,seller_account_id,status,metadata,description,category,condition")\n''',
    "listing fields select",
)
replace_once(
    card_edit,
    '''    const metadata = record(item.metadata);\n    const instaComp = record(metadata.instacomp);\n''',
    '''    const metadata = record(item.metadata);\n    const nextDescription = Object.prototype.hasOwnProperty.call(body, "description")\n      ? nullableText(body.description, 5000)\n      : item.description || null;\n    const nextCategory = Object.prototype.hasOwnProperty.call(body, "category")\n      ? nullableText(body.category, 160)\n      : item.category || null;\n    const nextCondition = Object.prototype.hasOwnProperty.call(body, "condition")\n      ? nullableText(body.condition, 120)\n      : item.condition || null;\n    const instaComp = record(metadata.instacomp);\n''',
    "listing field fallbacks",
)
replace_once(
    card_edit,
    '''          notes: `Seller confirmed private draft ${inventoryItemId}: ${title}`,\n''',
    '''          notes: `Seller confirmed private draft ${inventoryItemId}: ${displayTitle}`,\n''',
    "trusted lesson display title",
)
replace_once(
    card_edit,
    '''      .update({ title, metadata: nextMetadata, updated_at: editedAt })\n''',
    '''      .update({\n        title: displayTitle,\n        description: nextDescription,\n        category: nextCategory,\n        condition: nextCondition,\n        metadata: nextMetadata,\n        updated_at: editedAt,\n      })\n''',
    "persist listing review fields",
)
replace_once(
    card_edit,
    '''      title,\n      parallel: exactParallel,\n''',
    '''      title: displayTitle,\n      description: nextDescription,\n      category: nextCategory,\n      condition: nextCondition,\n      parallel: exactParallel,\n''',
    "return listing review fields",
)

print("KINGMAKER Pending full-review backend patch complete.")
