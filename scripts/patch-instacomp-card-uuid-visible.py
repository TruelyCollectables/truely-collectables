#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
api = ROOT / "src/app/api/account/seller/instacomp-pending/route.ts"
page = ROOT / "src/app/seller/instacomp-pending/page.tsx"


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


replace_once(
    api,
    '''        "id,legacy_product_id,seller_account_id,sku,title,description,category,condition,status,quantity,price,metadata,created_at,updated_at",\n''',
    '''        "id,legacy_product_id,card_uuid,seller_account_id,sku,title,description,category,condition,status,quantity,price,metadata,created_at,updated_at",\n''',
    "select first-class card UUID",
)
replace_once(
    api,
    '''        instaComp: {\n          source: textValue(instaComp.source),\n          scanId: textValue(instaComp.scanId),\n''',
    '''        instaComp: {\n          source: textValue(instaComp.source),\n          cardUuid: textValue(row.card_uuid) || textValue(instaComp.cardUuid),\n          scanId: textValue(instaComp.scanId),\n''',
    "return card UUID",
)
replace_once(
    page,
    '''  instaComp: {\n    source: string | null;\n    scanId: string | null;\n''',
    '''  instaComp: {\n    source: string | null;\n    cardUuid: string | null;\n    scanId: string | null;\n''',
    "PendingItem cardUuid type",
)
replace_once(
    page,
    '''                    <p className="mt-2 text-xs font-bold text-neutral-500">\n                      SKU {item.sku || "Not recorded"}\n                    </p>\n\n                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">\n''',
    '''                    <p className="mt-2 text-xs font-bold text-neutral-500">\n                      SKU {item.sku || "Not recorded"}\n                    </p>\n                    <div className="mt-2 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2">\n                      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-violet-800">\n                        Permanent Card UUID\n                      </p>\n                      <p className="mt-1 select-all break-all font-mono text-xs font-black text-violet-950">\n                        {item.instaComp.cardUuid || "UUID missing — listing blocked"}\n                      </p>\n                      <p className="mt-1 text-[10px] font-bold text-violet-700">\n                        Physical card ID · scan events may change, this number does not.\n                      </p>\n                    </div>\n\n                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">\n''',
    "visible permanent card UUID",
)

print("Pending Listings permanent card UUID visibility patch complete.")
