#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "src/app/api/account/seller/instacomp-scan/intake/route.ts"
source = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global source
    if new in source:
        print(f"already patched {label}")
        return
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one source block, found {count}")
    source = source.replace(old, new, 1)
    print(f"patched {label}")


replace_once(
    '''function receiptValue(scan: InstaCompAiLocalScan, prefix: string) {\n  return (\n    scan.checklist?.source_receipts\n      ?.find((value: string) => value.startsWith(prefix))\n      ?.slice(prefix.length) || null\n  );\n}\n''',
    '''function receiptValue(scan: InstaCompAiLocalScan, prefix: string) {\n  return (\n    scan.checklist?.source_receipts\n      ?.find((value: string) => value.startsWith(prefix))\n      ?.slice(prefix.length) || null\n  );\n}\n\nfunction physicalCardUuid(scan: InstaCompAiLocalScan) {\n  const value = text(scan.card_uuid, 64)?.toLowerCase() || null;\n  return value &&\n    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)\n    ? value\n    : null;\n}\n\nfunction isMissingCardUuidColumn(error: unknown) {\n  const record = recordValue(error);\n  const code = String(record.code || "").toUpperCase();\n  const message = [record.message, record.details, record.hint]\n    .filter(Boolean)\n    .join(" ")\n    .toLowerCase();\n  return (\n    code === "42703" ||\n    code === "PGRST204" ||\n    (message.includes("card_uuid") &&\n      (message.includes("does not exist") ||\n        message.includes("could not find") ||\n        message.includes("schema cache")))\n  );\n}\n''',
    "card UUID helpers",
)

replace_once(
    '''    const scan = await analyzeWithInstaCompAiLocal({\n      front: normalizedSides.frontFile,\n      back: normalizedSides.backFile,\n    });\n    const identity = lockedIdentity(scan);\n''',
    '''    const scan = await analyzeWithInstaCompAiLocal({\n      front: normalizedSides.frontFile,\n      back: normalizedSides.backFile,\n    });\n    const cardUuid = physicalCardUuid(scan);\n    if (!cardUuid) {\n      return NextResponse.json(\n        {\n          success: false,\n          code: "PHYSICAL_CARD_UUID_REQUIRED",\n          error:\n            "InstaComp did not return a valid permanent UUID for this physical card.",\n          scan,\n        },\n        { status: 409, headers: { "Cache-Control": "no-store" } },\n      );\n    }\n    const identity = lockedIdentity(scan);\n''',
    "require permanent UUID",
)

replace_once(
    '''      instacomp: {\n        source: "mac_registry_scanner",\n        scanId: scan.scan_id,\n        imagePairSha256,\n''',
    '''      instacomp: {\n        source: "mac_registry_scanner",\n        cardUuid,\n        scanId: scan.scan_id,\n        imagePairSha256,\n''',
    "persist UUID in inventory metadata",
)

replace_once(
    '''    const { data: inserted, error: insertError } = await supabase\n      .from("inventory_items")\n      .insert({\n        store_id: storeId,\n        seller_account_id: account.id,\n        title: appliedListing.title,\n        description: appliedListing.description,\n        category: "Trading Card Singles",\n        condition: grading.condition,\n        status: "draft",\n        quantity: 1,\n        price: 0,\n        metadata,\n      })\n      .select("id,title,status,price,metadata")\n      .single();\n    if (insertError) throw insertError;\n''',
    '''    const inventoryInsert = {\n      store_id: storeId,\n      seller_account_id: account.id,\n      title: appliedListing.title,\n      description: appliedListing.description,\n      category: "Trading Card Singles",\n      condition: grading.condition,\n      status: "draft",\n      quantity: 1,\n      price: 0,\n      metadata,\n    };\n    let { data: inserted, error: insertError } = await supabase\n      .from("inventory_items")\n      .insert({ ...inventoryInsert, card_uuid: cardUuid })\n      .select("id,title,status,price,metadata")\n      .single();\n\n    // During a rolling schema deployment, metadata remains the durable UUID\n    // handoff. Retry without the first-class column only when Postgres/PostgREST\n    // proves that card_uuid has not reached this database yet.\n    if (insertError && isMissingCardUuidColumn(insertError)) {\n      const fallback = await supabase\n        .from("inventory_items")\n        .insert(inventoryInsert)\n        .select("id,title,status,price,metadata")\n        .single();\n      inserted = fallback.data;\n      insertError = fallback.error;\n    }\n    if (insertError) throw insertError;\n    if (!inserted) throw new Error("Inventory draft was not returned after UUID intake.");\n''',
    "first-class UUID inventory insert with safe rollout fallback",
)

replace_once(
    '''        success: true,\n        inventoryItemId: inserted.id,\n        title: inserted.title,\n''',
    '''        success: true,\n        cardUuid,\n        inventoryItemId: inserted.id,\n        title: inserted.title,\n''',
    "return UUID to upload client",
)

path.write_text(source, encoding="utf-8")
print(f"updated {path}")
