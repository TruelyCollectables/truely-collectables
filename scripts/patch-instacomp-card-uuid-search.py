#!/usr/bin/env python3
from pathlib import Path

path = Path("src/modules/inventory/repository.ts")
source = path.read_text(encoding="utf-8")

helper_anchor = '''export class InventoryRepository {\n'''
helper = '''function validPhysicalCardUuid(value: string) {\n  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(\n    value.trim(),\n  );\n}\n\nexport class InventoryRepository {\n'''
if helper not in source:
    if source.count(helper_anchor) != 1:
        raise SystemExit("InventoryRepository class anchor changed unexpectedly")
    source = source.replace(helper_anchor, helper, 1)

old = '''    if (params.query) {\n      query = query.or(\n        `title.ilike.%${params.query}%,sku.ilike.%${params.query}%,description.ilike.%${params.query}%`\n      );\n    }\n'''
new = '''    if (params.query) {\n      const searchValue = params.query.trim();\n      const filters = [\n        `title.ilike.%${searchValue}%`,\n        `sku.ilike.%${searchValue}%`,\n        `description.ilike.%${searchValue}%`,\n      ];\n      if (validPhysicalCardUuid(searchValue)) {\n        filters.push(`card_uuid.eq.${searchValue.toLowerCase()}`);\n      }\n      query = query.or(filters.join(","));\n    }\n'''
if new not in source:
    if source.count(old) != 1:
        raise SystemExit("Inventory search block changed unexpectedly")
    source = source.replace(old, new, 1)

path.write_text(source, encoding="utf-8")
print("permanent card UUID inventory search applied")
